import { companies, env, productionCutoverAtMs, thresholdsMinutes } from '../config.js';
import { db } from '../db.js';
import { HighLevelClient } from '../highlevel/client.js';
import { sendSlaAlert } from '../telegram.js';
import { buildConversationUrl, incidentStillAllowsAlert } from './alertSafety.js';
import { ingestMessages, recheckOpenProvisionalIncidents } from './messageState.js';
import { resolveResponsibleGhlUser } from './routing.js';
import { getFallbackRecipients, getStaffByGhlUser, getTestRecipient, syncGhlUsers } from './staff.js';
import { productionRecipients } from './recipients.js';
import { writeSystemLog } from './systemLogs.js';

// Test alerts only concern messages arriving in this run. The 24-hour bootstrap
// import must not notify Dmitry for every historical conversation.
const testSessionStartedAt = Date.now() - 60_000;
const lastSuccessfulPollEnd = new Map<string, number>();

async function refreshGhlUsers(company: typeof companies[number]) {
  const ghl = new HighLevelClient(company);
  const locationPayload = await ghl.getLocation();
  const companyId = locationPayload?.location?.companyId || locationPayload?.companyId;
  if (!companyId) throw new Error(`${company.slug}: companyId not found from location`);
  const users = await ghl.searchUsers(companyId);
  await syncGhlUsers(company, users);
}

async function pollCompany(company: typeof companies[number]): Promise<void> {
  const ghl = new HighLevelClient(company);
  const now = Date.now();
  const overlapMs = Math.max(env.POLL_INTERVAL_SECONDS * 4, 300) * 1000;
  const previousEnd = lastSuccessfulPollEnd.get(company.slug);
  const startDate = new Date(previousEnd ? previousEnd - overlapMs : now - env.INITIAL_LOOKBACK_HOURS * 3600_000).toISOString();
  const endDate = new Date(now).toISOString();

  const [nonEmail, email] = await Promise.all([
    ghl.exportMessages({ startDate, endDate, email: false }),
    ghl.exportMessages({ startDate, endDate, email: true })
  ]);
  await ingestMessages(company, [...nonEmail, ...email]);
  lastSuccessfulPollEnd.set(company.slug, now);
}

async function getCompanyRow(slug: string) {
  const { data, error } = await db.from('companies').select('*').eq('slug', slug).single();
  if (error) throw error;
  return data;
}

async function getGhlUserName(companyId: string, ghlUserId?: string | null): Promise<string | null> {
  if (!ghlUserId) return null;
  const { data, error } = await db.from('ghl_users').select('name').eq('company_id', companyId).eq('ghl_user_id', ghlUserId).maybeSingle();
  if (error) throw error;
  return data?.name || null;
}

function contactNameFrom(value: any): string | null {
  if (!value) return null;
  const contact = value.contact || value;
  const candidate = contact.name || contact.fullName || contact.contactName
    || [contact.firstName, contact.lastName].filter(Boolean).join(' ')
    || contact.email || contact.phone;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function messageSenderName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  return candidate && candidate.length <= 200 ? candidate : null;
}

async function getContactName(company: typeof companies[number], state: any): Promise<string> {
  const { data: event, error: eventError } = await db.from('message_events')
    .select('raw').eq('company_id', state.company_id)
    .eq('message_id', state.latest_inbound_message_id).maybeSingle();
  if (eventError) throw eventError;
  const sender = messageSenderName((event?.raw as any)?.from);
  // Social and email exports contain a useful customer name/address already.
  // For SMS, prefer the CRM contact name but retain the phone as a safe fallback.
  if (sender && !/^\+?[\d\s().-]{7,}$/.test(sender)) return sender;

  const ghl = new HighLevelClient(company);
  try {
    const name = contactNameFrom(await ghl.getContact(state.contact_id, 1));
    if (name) return name;
  } catch {}

  try {
    const name = contactNameFrom(await ghl.getConversation(state.conversation_id, 1));
    if (name) return name;
  } catch {}

  if (sender) return sender;

  // An opaque CRM ID is confusing to the recipient and must never be presented
  // as a person's name. The conversation button still opens the exact contact.
  console.warn('Contact display name unavailable', { company: company.slug, conversationId: state.conversation_id });
  return 'Unknown contact';
}

async function claimAlert(state: any, threshold: number, staffId: string, existing?: any): Promise<string | null> {
  if (existing) {
    const recentAttempt = Date.now() - Date.parse(existing.last_attempt_at) < 10 * 60_000;
    if (existing.delivery_status === 'sent' || (existing.delivery_status === 'sending' && recentAttempt)) return null;
    const { error } = await db.from('alerts').update({
      delivery_status: 'sending',
      attempt_count: existing.attempt_count + 1,
      last_attempt_at: new Date().toISOString(),
      error_code: null
    }).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await db.from('alerts').insert({
    incident_id: state.id,
    company_id: state.company_id,
    conversation_id: state.conversation_id,
    contact_id: state.contact_id,
    inbound_message_id: state.latest_inbound_message_id,
    threshold_minutes: threshold,
    recipient_staff_id: staffId,
    delivery_status: 'sending',
    attempt_count: 1,
    last_attempt_at: new Date().toISOString()
  }).select('id').single();
  if (error?.code === '23505') return null;
  if (error) throw error;
  return data.id;
}

async function logRoutingIssueOnce(companyId: string, incidentId: string, conversationId: string, contactId: string, issueType: string, details: any) {
  const { data, error } = await db.from('routing_issues').select('id')
    .eq('company_id', companyId)
    .eq('conversation_id', conversationId)
    .eq('issue_type', issueType)
    .is('resolved_at', null)
    .maybeSingle();
  if (error) throw error;
  if (data) return;
  const { error: insertError } = await db.from('routing_issues').insert({
    company_id: companyId, incident_id: incidentId, conversation_id: conversationId,
    contact_id: contactId, issue_type: issueType, details
  });
  if (insertError) throw insertError;
  await writeSystemLog({ level: 'warn', eventType: issueType, companyId, conversationId, contactId, details });
}

async function logAssignmentMismatchOnce(companyId: string, state: any, route: any) {
  const { data, error } = await db.from('assignment_mismatches').select('id')
    .eq('company_id', companyId).eq('conversation_id', state.conversation_id)
    .is('resolved_at', null).maybeSingle();
  if (error) throw error;
  if (data) return;
  const { error: insertError } = await db.from('assignment_mismatches').insert({
    company_id: companyId,
    incident_id: state.id,
    conversation_id: state.conversation_id,
    contact_id: state.contact_id,
    opportunity_owner_id: route.mismatch.opportunityOwner || null,
    conversation_owner_id: route.mismatch.conversationOwner || null,
    contact_owner_id: route.mismatch.contactOwner || null,
    selected_owner_id: route.ghlUserId,
    selected_source: route.source
  });
  if (insertError) throw insertError;
}

async function evaluateAlerts(): Promise<void> {
  const { data: states, error } = await db.from('sla_incidents').select('*').eq('status', 'open');
  if (error) throw error;
  if (!states?.length) return;

  const incidentIds = states.map((state: any) => state.id);
  const { data: existingAlerts, error: alertsError } = await db.from('alerts')
    .select('id,incident_id,inbound_message_id,threshold_minutes,recipient_staff_id,delivery_status,last_attempt_at,attempt_count')
    .in('incident_id', incidentIds);
  if (alertsError) throw alertsError;
  const alertByKey = new Map((existingAlerts || []).map((alert: any) => [
    `${alert.incident_id}:${alert.inbound_message_id}:${alert.threshold_minutes}:${alert.recipient_staff_id}`,
    alert
  ]));
  const thresholdAlerts = (state: any, threshold: number) => (existingAlerts || []).filter((alert: any) =>
    alert.incident_id === state.id
    && alert.inbound_message_id === state.latest_inbound_message_id
    && alert.threshold_minutes === threshold);
  const isCoveredBySentThreshold = (state: any, threshold: number, staffId: string) =>
    [...alertByKey.values()].some((alert: any) =>
      alert.incident_id === state.id
      && alert.inbound_message_id === state.latest_inbound_message_id
      && alert.recipient_staff_id === staffId
      && alert.threshold_minutes >= threshold
      && alert.delivery_status === 'sent');
  const shouldAttemptRecipient = (state: any, threshold: number, recipient: any) => {
    if (!recipient.telegram_chat_id || isCoveredBySentThreshold(state, threshold, recipient.id)) return false;
    const rows = thresholdAlerts(state, threshold);
    const existing = alertByKey.get(`${state.id}:${state.latest_inbound_message_id}:${threshold}:${recipient.id}`) as any;
    // Once delivery of a threshold has started, do not backfill it to people
    // who register later. Existing failed attempts remain retryable.
    if (rows.length && !existing) return false;
    if (!existing) return true;
    const recentAttempt = Date.now() - Date.parse(existing.last_attempt_at) < 10 * 60_000;
    return existing.delivery_status !== 'sent' && !(existing.delivery_status === 'sending' && recentAttempt);
  };

  const globalRecipients = env.TEST_MODE ? [] : await getFallbackRecipients();

  for (const state of states || []) {
    try {
    const { data: row, error: rowErr } = await db.from('companies').select('slug').eq('id', state.company_id).maybeSingle();
    if (rowErr) throw rowErr;
    const actualCompany = companies.find(c => c.slug === row?.slug);
    if (!actualCompany) continue;

    const waitingMinutes = Math.floor((Date.now() - Date.parse(state.latest_inbound_at)) / 60_000);
    if (env.TEST_MODE && Date.parse(state.latest_inbound_at) < testSessionStartedAt) continue;
    if (!env.TEST_MODE && productionCutoverAtMs !== null && Date.parse(state.latest_inbound_at) < productionCutoverAtMs) continue;
    const dueThresholds = thresholdsMinutes.filter(t => waitingMinutes >= t);
    if (!dueThresholds.length) continue;

    const companyRow = await getCompanyRow(actualCompany.slug);
    let route = {
      ghlUserId: state.responsible_ghl_user_id || null,
      source: state.responsible_source || 'unassigned',
      mismatch: undefined as any
    };
    let ownerStaff = await getStaffByGhlUser(actualCompany.slug, route.ghlUserId);
    let preliminaryRecipients = env.TEST_MODE
      ? [await getTestRecipient()].filter(Boolean)
      : productionRecipients(ownerStaff, globalRecipients);
    const needsWork = dueThresholds.some(threshold =>
      preliminaryRecipients.some((recipient: any) => shouldAttemptRecipient(state, threshold, recipient)));
    if (!needsWork) continue;

    // Refresh routing only when a threshold actually needs delivery. The old
    // implementation repeated three live GHL lookups for every open incident
    // every minute, exhausted the API limit and delayed reply ingestion.
    const hasNewThreshold = dueThresholds.some(threshold => !(existingAlerts || []).some((alert: any) =>
      alert.incident_id === state.id
      && alert.inbound_message_id === state.latest_inbound_message_id
      && alert.threshold_minutes === threshold));
    if (hasNewThreshold) {
      route = await resolveResponsibleGhlUser(actualCompany, state.conversation_id, state.contact_id) as typeof route;
      ownerStaff = await getStaffByGhlUser(actualCompany.slug, route.ghlUserId);
    }
    const ownerName = await getGhlUserName(companyRow.id, route.ghlUserId);
    if (!ownerStaff) await logRoutingIssueOnce(companyRow.id, state.id, state.conversation_id, state.contact_id, 'unmapped_owner', {
      ghlUserId: route.ghlUserId, ownerName, source: route.source
    });
    let recipients: any[] = [];
    let routingNote = '';

    if (env.TEST_MODE) {
      const testRecipient = await getTestRecipient();
      if (testRecipient) recipients = [testRecipient];
      routingNote = `TEST MODE · production owner would be ${ownerName || route.ghlUserId || 'unassigned'}`;
    } else {
      recipients = productionRecipients(ownerStaff, globalRecipients);
      if (!ownerStaff?.telegram_chat_id) {
        routingNote = `${ownerStaff ? 'Owner has not registered Telegram' : 'Owner mapping missing'} (${ownerName || route.ghlUserId || 'unassigned'}). Escalated to manager/admin.`;
        if (ownerStaff) await logRoutingIssueOnce(companyRow.id, state.id, state.conversation_id, state.contact_id, 'unregistered_owner', {
          ghlUserId: route.ghlUserId, ownerName, source: route.source
        });
      }
    }

    const { error: stateUpdateError } = await db.from('sla_incidents').update({
      responsible_ghl_user_id: route.ghlUserId,
      responsible_source: route.source,
      updated_at: new Date().toISOString()
    }).eq('id', state.id);
    if (stateUpdateError) throw stateUpdateError;

    if (route.mismatch) {
      routingNote = [routingNote, 'CRM assignment mismatch detected.'].filter(Boolean).join(' ');
      await logAssignmentMismatchOnce(companyRow.id, state, route);
    }

    const contactName = await getContactName(actualCompany, state);
    const url = buildConversationUrl(actualCompany.conversationUrlTemplate, {
      conversationId: state.conversation_id, contactId: state.contact_id,
      locationId: actualCompany.locationId, contactName
    });
    // Process the most severe due threshold first. A successful 120-minute
    // breach covers missed 60/90 notifications after downtime without spam.
    for (const threshold of [...dueThresholds].sort((a, b) => b - a)) {
      const unique = new Map<string, any>();
      for (const r of recipients) unique.set(r.id, r);

      for (const recipient of unique.values()) {
        if (!shouldAttemptRecipient(state, threshold, recipient)) continue;
        // Polling runs independently from alert evaluation. Re-read the incident
        // immediately before every send so a reply ingested meanwhile cancels
        // all remaining notifications from this stale evaluation snapshot.
        const { data: fresh, error: freshError } = await db.from('sla_incidents')
          .select('status,latest_inbound_message_id').eq('id', state.id).single();
        if (freshError) throw freshError;
        if (!incidentStillAllowsAlert(state, fresh)) break;

        const key = `${state.id}:${state.latest_inbound_message_id}:${threshold}:${recipient.id}`;
        const alertId = await claimAlert(state, threshold, recipient.id, alertByKey.get(key));
        if (!alertId) continue;

        try {
          const telegramMessageId = await sendSlaAlert({
            recipient,
            companyName: actualCompany.displayName,
            contactName,
            ownerName,
            channel: state.channel,
            waitingMinutes,
            thresholdMinutes: threshold,
            severity: threshold === thresholdsMinutes[2] ? 'breach' : threshold === thresholdsMinutes[1] ? 'warning' : 'waiting',
            body: state.latest_inbound_body,
            conversationUrl: url,
            routingNote
          });
          const { error: alertUpdateError } = await db.from('alerts').update({
            delivery_status: 'sent',
            telegram_message_id: telegramMessageId ? String(telegramMessageId) : null,
            sent_at: new Date().toISOString(),
            error_code: null
          }).eq('id', alertId);
          if (alertUpdateError) throw alertUpdateError;
          const sentAlert = {
            ...(alertByKey.get(key) as any || {}), id: alertId,
            incident_id: state.id,
            inbound_message_id: state.latest_inbound_message_id,
            threshold_minutes: threshold,
            recipient_staff_id: recipient.id,
            delivery_status: 'sent',
            last_attempt_at: new Date().toISOString()
          };
          alertByKey.set(key, sentAlert);
          if (!(existingAlerts || []).some((alert: any) => alert.id === alertId)) (existingAlerts || []).push(sentAlert);
        } catch (sendError) {
          const errorCode = sendError instanceof Error ? sendError.message.slice(0, 120) : 'unknown';
          await db.from('alerts').update({ delivery_status: 'failed', error_code: errorCode }).eq('id', alertId);
          await writeSystemLog({
            level: 'error', eventType: 'telegram_alert_failed', companyId: companyRow.id,
            conversationId: state.conversation_id, contactId: state.contact_id,
            details: { threshold, recipientStaffId: recipient.id, errorCode }
          });
          console.error('Telegram alert failed', { company: actualCompany.slug, threshold, recipientId: recipient.id, error: errorCode });
        }
      }
    }
    } catch (stateError) {
      console.error('SLA conversation evaluation failed', {
        companyId: state.company_id,
        error: stateError instanceof Error ? stateError.message : 'unknown'
      });
    }
  }
}

export async function startMonitor(): Promise<void> {
  for (const company of companies) {
    await refreshGhlUsers(company);
    await pollCompany(company);
  }
  const initialRechecked = await recheckOpenProvisionalIncidents(companies);
  if (initialRechecked) console.info('Rechecked provisional AI incidents', { count: initialRechecked });
  await evaluateAlerts();

  const pollLoop = async () => {
    for (const company of companies) {
      try { await pollCompany(company); } catch (e) { console.error('GHL poll failed', company.slug, e); }
    }
    try {
      const rechecked = await recheckOpenProvisionalIncidents(companies);
      if (rechecked) console.info('Rechecked provisional AI incidents', { count: rechecked });
    } catch (e) { console.error('Provisional AI incident recheck failed', e); }
    setTimeout(pollLoop, env.POLL_INTERVAL_SECONDS * 1000);
  };
  setTimeout(pollLoop, env.POLL_INTERVAL_SECONDS * 1000);

  // Keep evaluation separate so slow/rate-limited owner lookups can never stop
  // ingestion of a real human reply.
  const alertLoop = async () => {
    try { await evaluateAlerts(); } catch (e) { console.error('SLA evaluation failed', e); }
    setTimeout(alertLoop, env.POLL_INTERVAL_SECONDS * 1000);
  };
  setTimeout(alertLoop, Math.max(10_000, env.POLL_INTERVAL_SECONDS * 500));

  setInterval(async () => {
    for (const company of companies) {
      try { await refreshGhlUsers(company); } catch (e) { console.error('GHL user refresh failed', company.slug, e); }
    }
  }, 6 * 3600_000);
}
