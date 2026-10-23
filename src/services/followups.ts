import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { companies, env } from '../config.js';
import { bot } from '../telegram.js';
import { HighLevelClient } from '../highlevel/client.js';
import type { CompanyConfig, GhlMessage } from '../types.js';
import { isCustomerCommunication, isHumanOutbound } from './classification.js';
import { messagePreview, truncate } from '../utils/text.js';
import { FollowupAi } from './followupAi.js';
import { followupRecipients } from './followupPolicy.js';
import { renderFollowupNotification } from './followupTelegram.js';
import { resolveResponsibleGhlUser } from './routing.js';
import { getFallbackRecipients, getStaffByGhlUser, getTestRecipient } from './staff.js';
import { buildConversationUrl } from './alertSafety.js';

const ai = new FollowupAi({ apiKey: env.FOLLOWUP_GROQ_API_KEY || env.GROQ_API_KEY,
  model: env.AI_MODEL, timeoutMs: Math.max(env.AI_TIMEOUT_MS, 15_000) });
class DeliveryUncertain extends Error {}

async function prepare(company: CompanyConfig, thread: any) {
  const ghl = new HighLevelClient(company);
  const conversation = await ghl.getConversation(thread.conversation_id, 1);
  if (conversation.locationId !== company.locationId || conversation.contactId !== thread.contact_id || conversation.deleted) return null;
  const raw = await ghl.getConversationMessages(thread.conversation_id, thread.anchor_message_id);
  const { data: users, error: userError } = await db.from('ghl_users').select('ghl_user_id').eq('company_id', thread.company_id);
  if (userError) throw userError;
  const humans = new Set<string>((users || []).map(user => user.ghl_user_id));
  const messages = raw.filter(message => message.locationId === company.locationId
    && message.conversationId === thread.conversation_id && message.contactId === thread.contact_id
    && isCustomerCommunication(message)).sort((a,b) => Date.parse(a.dateAdded) - Date.parse(b.dateAdded));
  const anchor = messages.find(message => message.id === thread.anchor_message_id);
  if (!anchor || !isHumanOutbound(anchor, humans)) return null;
  // A newer real message invalidates the reminder. Let normal ingestion reconcile it.
  if (messages.some(message => Date.parse(message.dateAdded) > Date.parse(anchor.dateAdded)
    && (message.direction === 'inbound' || isHumanOutbound(message, humans)))) return null;
  const inbound = messages.filter(message => message.direction === 'inbound' && Date.parse(message.dateAdded) <= Date.parse(anchor.dateAdded));
  if (!inbound.length) return null;
  const route = await resolveResponsibleGhlUser(company, thread.conversation_id, thread.contact_id);
  const owner = await getStaffByGhlUser(company.slug, route.ghlUserId);
  const { data: ghlUser, error: ghlError } = route.ghlUserId
    ? await db.from('ghl_users').select('name').eq('company_id', thread.company_id).eq('ghl_user_id', route.ghlUserId).maybeSingle()
    : { data: null, error: null };
  if (ghlError) throw ghlError;
  const contact = await ghl.getContact(thread.contact_id, 1);
  if (contact.locationId && contact.locationId !== company.locationId) return null;
  const contactName = contact.name || contact.fullName || [contact.firstName,contact.lastName].filter(Boolean).join(' ')
    || contact.email || contact.phone || 'Unknown contact';
  const url = buildConversationUrl(company.conversationUrlTemplate, {
    locationId: company.locationId, conversationId: thread.conversation_id, contactId: thread.contact_id, contactName
  });
  if (!url) return null;
  const context = messages.slice(-12).map(message => ({ direction: message.direction,
    human: isHumanOutbound(message, humans), at: message.dateAdded,
    text: truncate(messagePreview(message.body, thread.channel) || '[attachment without text]', 600) }));
  const suggestion = await ai.suggest(context, thread.stage);
  return { suggestion, owner, ownerName: ghlUser?.name || owner?.name || 'Не назначен', contactName, url, anchor };
}

async function deliver(company: CompanyConfig, thread: any, prepared: NonNullable<Awaited<ReturnType<typeof prepare>>> & { demo?: boolean },
  preview: boolean, companyAllowsAlerts: (slug: string) => boolean = () => false): Promise<number> {
  const suggestion = prepared.suggestion;
  if (!suggestion?.should_follow_up || suggestion.confidence < 0.9) return 0;
  const test = preview ? await getTestRecipient() : null;
  const globals = preview ? [] : await getFallbackRecipients();
  const recipients = followupRecipients(preview ? 'preview' : env.FOLLOWUP_MODE, prepared.owner, globals, test);
  let sent = 0;
  let firstSentAt: string | null = null;
  for (const recipient of recipients) {
    if (!recipient.telegram_chat_id) continue;
    if (!preview) {
      if (env.FOLLOWUP_MODE !== 'production' || env.TEST_MODE || !companyAllowsAlerts(company.slug)) break;
      const { data: fresh, error } = await db.from('followup_threads').select('status,stage,last_event_key')
        .eq('id', thread.id).single();
      if (error) throw error;
      if (fresh.status !== 'waiting' || fresh.stage !== thread.stage || fresh.last_event_key !== thread.last_event_key) break;
      const { data: newer, error: newerError } = await db.from('message_events').select('id,direction,is_human_outbound')
        .eq('company_id', thread.company_id).eq('conversation_id', thread.conversation_id).gt('date_added', thread.anchor_at);
      if (newerError) throw newerError;
      if (newer?.some(message => message.direction === 'inbound' || message.is_human_outbound)) break;
    }
    const dedupe = preview ? `preview:${randomUUID()}`
      : `${thread.id}:${thread.cycle_inbound_message_id}:${thread.stage}:${recipient.id}`;
    const { data: notice, error: claimError } = await db.from('followup_notifications').insert({
      dedupe_key: dedupe, thread_id: preview ? null : thread.id, company_id: thread.company_id,
      conversation_id: thread.conversation_id, cycle_inbound_message_id: thread.cycle_inbound_message_id,
      anchor_message_id: thread.anchor_message_id, stage: thread.stage, recipient_staff_id: recipient.id,
      preview, draft: suggestion.draft, ai_model: env.AI_MODEL, ai_reason: suggestion.reason, delivery_status: 'sending'
    }).select('id').single();
    if (claimError?.code === '23505') continue;
    if (claimError) throw claimError;
    const rendered = renderFollowupNotification({ companyName: company.displayName,
      contactName: prepared.contactName, ownerName: prepared.ownerName, channel: thread.channel, stage: thread.stage,
      waitingHours: (Date.now() - Date.parse(thread.anchor_at)) / 3600_000,
      draft: suggestion.draft, conversationUrl: prepared.url, preview, demo: prepared.demo });
    try {
      // One attempt: an ambiguous network result must not create duplicate reminders.
      const message = await bot.api.sendMessage(Number(recipient.telegram_chat_id), rendered.text, {
        parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: rendered.keyboard
      });
      const sentAt = new Date().toISOString();
      const { error } = await db.from('followup_notifications').update({ delivery_status: 'sent',
        telegram_message_id: String(message.message_id), sent_at: sentAt }).eq('id', notice.id);
      if (error) throw error;
      firstSentAt ||= sentAt;
      sent++;
    } catch {
      await db.from('followup_notifications').update({ delivery_status: 'uncertain' }).eq('id', notice.id);
      throw new DeliveryUncertain('Follow-up delivery uncertain; automatic resend disabled');
    }
  }
  if (!preview && firstSentAt) {
    const { error } = await db.from('followup_threads').update({ status: 'reminded', reminded_at: firstSentAt,
      updated_at: new Date().toISOString() }).eq('id', thread.id).eq('last_event_key', thread.last_event_key).eq('status','waiting');
    if (error) throw error;
  }
  return sent;
}

export async function evaluateFollowups(companyAllowsAlerts: (slug: string) => boolean): Promise<void> {
  // Preview mode NEVER has an automatic delivery path, even to Dmitry. Only an explicit preview command sends one example.
  if (env.FOLLOWUP_MODE !== 'production' || env.TEST_MODE) return;
  const { data: threads, error } = await db.from('followup_threads').select('*,companies!inner(slug)')
    .eq('status','waiting').lte('due_at',new Date().toISOString()).order('due_at').limit(10);
  if (error) throw error;
  for (const thread of threads || []) {
    const company = companies.find(company => company.slug === (thread.companies as any).slug);
    if (!company || !companyAllowsAlerts(company.slug)) continue;
    try {
      const prepared = await prepare(company, thread);
      const suggestion = prepared?.suggestion;
      if (!suggestion || suggestion.confidence < 0.9 || !prepared) {
        await db.from('followup_threads').update({ due_at: new Date(Date.now()+30*60_000).toISOString() })
          .eq('id',thread.id).eq('last_event_key',thread.last_event_key);
        continue;
      }
      if (!suggestion.should_follow_up) {
        const defer = suggestion.defer_until ? Date.parse(suggestion.defer_until) : 0;
        const future = defer > Date.now() && defer <= Date.now()+30*86400_000;
        const { error: suppressError } = await db.from('followup_threads').update(future
          ? { due_at: new Date(defer).toISOString() } : { status: 'suppressed' })
          .eq('id',thread.id).eq('last_event_key',thread.last_event_key);
        if (suppressError) throw suppressError;
        continue;
      }
      await deliver(company, thread, prepared, false, companyAllowsAlerts);
    } catch {
      console.warn('Follow-up evaluation deferred', { company: company.slug });
    }
  }
}

export async function sendOneFollowupPreview(): Promise<void> {
  if (env.FOLLOWUP_MODE !== 'preview') throw new Error('Explicit preview mode is required');
  const recipient = await getTestRecipient();
  if (!recipient?.telegram_chat_id) throw new Error('Dmitry has not registered');
  const { data: candidates, error } = await db.from('message_events')
    .select('company_id,conversation_id,contact_id,message_id,date_added,channel')
    .eq('is_human_outbound',true).lt('date_added',new Date(Date.now()-24*3600_000).toISOString())
    .gte('date_added',new Date(Date.now()-30*86400_000).toISOString())
    .order('date_added',{ascending:false}).limit(80);
  if (error) throw error;
  const { data: companyRows, error: companyError } = await db.from('companies').select('id,slug');
  if (companyError) throw companyError;
  const seen = new Set<string>();
  let checked = 0;
  for (const candidate of candidates || []) {
    const key = `${candidate.company_id}:${candidate.conversation_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (++checked > 12) break;
    const company = companies.find(company => company.slug === companyRows?.find(row => row.id===candidate.company_id)?.slug);
    if (!company) continue;
    try {
      const thread = { ...candidate, anchor_message_id: candidate.message_id, anchor_at: candidate.date_added,
        cycle_inbound_message_id: 'preview', stage: 1 };
      const prepared = await prepare(company, thread);
      if (!prepared?.suggestion?.should_follow_up || prepared.suggestion.confidence < 0.9) continue;
      if (await deliver(company, thread, prepared, true) === 1) {
        console.info('One follow-up preview delivered to Dmitry only', { company: company.slug, stage: 1 });
        return;
      }
    } catch (error) {
      if (error instanceof DeliveryUncertain) throw error;
      console.info('Preview candidate skipped; no customer message sent');
    }
  }
  throw new Error('No verified actionable preview candidate found; nothing sent');
}

export async function sendOneFollowupDemo(): Promise<void> {
  if (env.FOLLOWUP_MODE !== 'preview') throw new Error('Explicit preview mode required');
  const company = companies.find(company => company.slug === 'verona');
  if (!company) throw new Error('Verona not configured');
  const { data: companyRow, error: companyError } = await db.from('companies').select('id').eq('slug',company.slug).single();
  if (companyError) throw companyError;
  // Select metadata only. No real customer text or name is sent to Groq.
  const { data: sample, error } = await db.from('message_events').select('conversation_id,contact_id')
    .eq('company_id',companyRow.id).order('date_added',{ascending:false}).limit(1).single();
  if (error) throw error;
  const conversation = await new HighLevelClient(company).getConversation(sample.conversation_id,1);
  if (conversation.locationId !== company.locationId || conversation.contactId !== sample.contact_id || conversation.deleted) {
    throw new Error('Demo CRM link not verified');
  }
  const url = buildConversationUrl(company.conversationUrlTemplate, {
    conversationId: sample.conversation_id, contactId: sample.contact_id, locationId: company.locationId
  });
  if (!url) throw new Error('CRM link not configured');
  const now = Date.now();
  const anchorAt = new Date(now-25*3600_000).toISOString();
  const suggestion = await ai.suggest([
    { direction:'inbound',human:false,at:new Date(now-26*3600_000).toISOString(),text:'Hi, could you send the quote for the wall panels we discussed?' },
    { direction:'outbound',human:true,at:anchorAt,text:'Hi Alex! Here is the quote for the wall panels. Please let me know if you have any questions.' }
  ],1);
  if (!suggestion?.should_follow_up || suggestion.confidence<0.9) throw new Error('Demo draft unavailable');
  const thread = {company_id:companyRow.id,conversation_id:sample.conversation_id,contact_id:sample.contact_id,
    anchor_message_id:'fictional-demo-sales-message',cycle_inbound_message_id:'fictional-demo-customer-message',
    anchor_at:anchorAt,stage:1,channel:'SMS'};
  const sent = await deliver(company,thread,{suggestion,owner:null,ownerName:'Mary · вымышленный пример',
    contactName:'Alex · вымышленный пример',url,anchor:{} as GhlMessage,demo:true},true);
  if (sent!==1) throw new Error('Demo delivery not confirmed');
  console.info('One fictional follow-up demo delivered to Dmitry only; no real customer text sent to Groq');
}
