import { companies, env, productionCutoverAtMs, thresholdsMinutes } from '../config.js';
import { db } from '../db.js';
import { HighLevelClient } from '../highlevel/client.js';
import { sendSlaAlert } from '../telegram.js';
import { ingestMessages } from './messageState.js';
import { resolveResponsibleGhlUser } from './routing.js';
import { getFallbackRecipients, getStaffByGhlUser, getTestRecipient, syncGhlUsers } from './staff.js';
import { productionRecipients } from './recipients.js';
import { writeSystemLog } from './systemLogs.js';

// Test alerts only concern messages arriving in this run. The 24-hour bootstrap
// import must not notify Dmitry for every historical conversation.
const testSessionStartedAt = Date.now() - 60_000;
const lastSuccessfulPollEnd = new Map<string, number>();

function buildConversationUrl(template: string | undefined, values: { conversationId: string; contactId: string; locationId: string; contactName: string }): string | null {
  if (!template) return null;
  const rendered = template
    .replaceAll('{conversationId}', encodeURIComponent(values.conversationId))
    .replaceAll('{contactId}', encodeURIComponent(values.contactId))
    .replaceAll('{locationId}', encodeURIComponent(values.locationId))
    .replaceAll('{contactName}', encodeURIComponent(values.contactName));

  // HighLevel falls back to the first visible inbox conversation when a deep-linked
  // conversation is not already loaded in the current result set. Supplying the
  // client name as the inbox query makes HighLevel load that result before applying
  // the conversationId path, so the button consistently opens the intended thread.
  const url = new URL(rendered);
  if (!url.searchParams.has('query')) url.searchParams.set('query', values.contactName);
  return url.toString();
}

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

async function getContactName(company: typeof companies[number], contactId: string): Promise<string> {
  try {
    const contact = await new HighLevelClient(company).getContact(contactId);
    return contact?.name || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.email || contact?.phone || contactId;
  } catch {
    return contactId;
  }
}

async function claimAlert(state: any, threshold: number, staffId: string): Promise<string | null> {
  const { data: existing, error: lookupError } = await db.from('alerts')
    .select('id,delivery_status,last_attempt_at,attempt_count')
    .eq('incident_id', state.id)
    .eq('inbound_message_id', state.latest_inbound_message_id)
    .eq('threshold_minutes', threshold)
    .eq('recipient_staff_id', staffId)
    .maybeSingle();
  if (lookupError) throw lookupError;
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
  const now = Date.now();

  for (const state of states || []) {
    try {
    const { data: row, error: rowErr } = await db.from('companies').select('slug').eq('id', state.company_id).maybeSingle();
    if (rowErr) throw rowErr;
    const actualCompany = companies.find(c => c.slug === row?.slug);
    if (!actualCompany) continue;

    const waitingMinutes = Math.floor((now - Date.parse(state.latest_inbound_at)) / 60_000);
    if (env.TEST_MODE && Date.parse(state.latest_inbound_at) < testSessionStartedAt) continue;
    if (!env.TEST_MODE && productionCutoverAtMs !== null && Date.parse(state.latest_inbound_at) < productionCutoverAtMs) continue;
    const dueThresholds = thresholdsMinutes.filter(t => waitingMinutes >= t);
    if (!dueThresholds.length) continue;

    const companyRow = await getCompanyRow(actualCompany.slug);
    const route = await resolveResponsibleGhlUser(actualCompany, state.conversation_id, state.contact_id);
    const ownerName = await getGhlUserName(companyRow.id, route.ghlUserId);
    const ownerStaff = await getStaffByGhlUser(actualCompany.slug, route.ghlUserId);
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
      const globalRecipients = await getFallbackRecipients();
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

    const contactName = await getContactName(actualCompany, state.contact_id);
    const url = buildConversationUrl(actualCompany.conversationUrlTemplate, {
      conversationId: state.conversation_id, contactId: state.contact_id,
      locationId: actualCompany.locationId, contactName
    });
    for (const threshold of dueThresholds) {
      const unique = new Map<string, any>();
      for (const r of recipients) unique.set(r.id, r);

      for (const recipient of unique.values()) {
        if (!recipient.telegram_chat_id) continue;
        const alertId = await claimAlert(state, threshold, recipient.id);
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
  await evaluateAlerts();

  const pollLoop = async () => {
    for (const company of companies) {
      try { await pollCompany(company); } catch (e) { console.error('GHL poll failed', company.slug, e); }
    }
    try { await evaluateAlerts(); } catch (e) { console.error('SLA evaluation failed', e); }
    setTimeout(pollLoop, env.POLL_INTERVAL_SECONDS * 1000);
  };
  setTimeout(pollLoop, env.POLL_INTERVAL_SECONDS * 1000);

  setInterval(async () => {
    for (const company of companies) {
      try { await refreshGhlUsers(company); } catch (e) { console.error('GHL user refresh failed', company.slug, e); }
    }
  }, 6 * 3600_000);
}
