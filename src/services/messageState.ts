import { db } from '../db.js';
import type { CompanyConfig, GhlMessage } from '../types.js';
import { env } from '../config.js';
import { messagePreview, truncate } from '../utils/text.js';
import { inboundClassifier, suppressesSlaIncident, type AiClassification, type AiConversationMessage } from './aiClassifier.js';
import { isCustomerCommunication, isHumanOutbound, normalizeChannel } from './classification.js';

async function knownHumanUserIds(companyId: string): Promise<Set<string>> {
  const { data, error } = await db.from('ghl_users').select('ghl_user_id').eq('company_id', companyId);
  if (error) throw error;
  return new Set((data || []).map((r: any) => r.ghl_user_id));
}

async function conversationContext(companyId: string, message: GhlMessage): Promise<AiConversationMessage[]> {
  const { data, error } = await db.from('message_events')
    .select('direction,body,channel,is_human_outbound,date_added')
    .eq('company_id', companyId)
    .eq('conversation_id', message.conversationId)
    .lt('date_added', message.dateAdded)
    .order('date_added', { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data || []).reverse().map(row => ({
    direction: row.direction,
    humanOutbound: row.is_human_outbound,
    text: truncate(messagePreview(row.body, row.channel) || '[attachment or non-text message]', 500)
  }));
}

async function classifyInbound(companyId: string, message: GhlMessage, channel: string): Promise<AiClassification> {
  const { data: stored, error: storedError } = await db.from('message_events')
    .select('ai_needs_reply,ai_confidence,ai_reason,ai_model,ai_classified_at')
    .eq('company_id', companyId)
    .eq('message_id', message.id)
    .single();
  if (storedError) throw storedError;
  if (stored.ai_classified_at && stored.ai_needs_reply !== null && stored.ai_confidence !== null && stored.ai_reason && stored.ai_model) {
    return {
      needsReply: stored.ai_needs_reply,
      confidence: Number(stored.ai_confidence),
      reason: stored.ai_reason,
      model: stored.ai_model,
      classifiedAt: stored.ai_classified_at
    };
  }

  const context = await conversationContext(companyId, message);
  const latest = truncate(messagePreview(message.body, channel) || '', 1000);
  const classification = await inboundClassifier.classify(latest, context);
  const { error } = await db.from('message_events').update({
    ai_needs_reply: classification.needsReply,
    ai_confidence: classification.confidence,
    ai_reason: classification.reason,
    ai_model: classification.model,
    ai_classified_at: classification.classifiedAt
  }).eq('company_id', companyId).eq('message_id', message.id);
  if (error) throw error;
  return classification;
}

export function planInboundIncident(
  existing: { id: string; latest_inbound_at: string } | null,
  candidate: Record<string, unknown> & { latest_inbound_at: string },
  classification: Pick<AiClassification, 'needsReply' | 'confidence'>,
  confidenceThreshold: number
): { action: 'ignore' | 'preserve' } | { action: 'upsert'; incident: typeof candidate } {
  if (suppressesSlaIncident(classification, confidenceThreshold)) {
    return { action: existing ? 'preserve' : 'ignore' };
  }
  if (existing && Date.parse(existing.latest_inbound_at) > Date.parse(candidate.latest_inbound_at)) {
    return { action: 'preserve' };
  }
  return { action: 'upsert', incident: candidate };
}

export async function ingestMessages(company: CompanyConfig, messages: GhlMessage[]): Promise<number> {
  const { data: companyRow, error: cErr } = await db.from('companies').select('id').eq('slug', company.slug).single();
  if (cErr) throw cErr;
  const humans = await knownHumanUserIds(companyRow.id);
  let processed = 0;

  const sorted = [...messages]
    .filter(isCustomerCommunication)
    .filter(m => m.id && m.conversationId && m.contactId && m.dateAdded && Number.isFinite(Date.parse(m.dateAdded)))
    .sort((a,b) => Date.parse(a.dateAdded) - Date.parse(b.dateAdded)
      || (a.direction === b.direction ? 0 : a.direction === 'inbound' ? -1 : 1)
      || a.id.localeCompare(b.id));

  const unknownChannels = new Set(sorted.map(normalizeChannel).filter((channel): channel is string => !!channel?.startsWith('Other:')));
  for (const channel of unknownChannels) console.warn('New HighLevel message channel retained for SLA review', { company: company.slug, channel });

  for (const m of sorted) {
    const channel = normalizeChannel(m);
    if (!channel) continue;
    const humanOutbound = isHumanOutbound(m, humans);
    const { error: insertErr } = await db.from('message_events').upsert({
      company_id: companyRow.id,
      message_id: m.id,
      conversation_id: m.conversationId,
      contact_id: m.contactId,
      direction: m.direction,
      message_type: m.messageType || null,
      channel,
      body: m.body || null,
      source: m.source || null,
      ghl_user_id: m.userId || null,
      is_human_outbound: humanOutbound,
      date_added: m.dateAdded,
      raw: m
    }, { onConflict: 'company_id,message_id' });
    if (insertErr) throw insertErr;

    if (m.direction === 'inbound') {
      const classification = await classifyInbound(companyRow.id, m, channel);
      if (classification.reason === 'pre-ai-baseline') {
        processed++;
        continue;
      }
      if (classification.reason.startsWith('fallback:')) {
        console.warn('AI classification used safe SLA fallback', { company: company.slug, reason: classification.reason });
      }
      const { data: recordedIncident, error: recordedError } = await db.from('sla_incidents')
        .select('id').eq('company_id', companyRow.id).eq('latest_inbound_message_id', m.id).maybeSingle();
      if (recordedError) throw recordedError;
      if (recordedIncident) continue;

      const { data: prior, error: priorErr } = await db.from('sla_incidents')
        .select('id,latest_inbound_at').eq('company_id', companyRow.id)
        .eq('conversation_id', m.conversationId).eq('status', 'open').maybeSingle();
      if (priorErr) throw priorErr;
      const candidate = {
        company_id: companyRow.id,
        conversation_id: m.conversationId,
        contact_id: m.contactId,
        latest_inbound_at: m.dateAdded,
        latest_inbound_message_id: m.id,
        latest_inbound_body: m.body || null,
        channel,
        status: 'open',
        resolved_at: null,
        resolved_by_message_id: null,
        updated_at: new Date().toISOString()
      };
      // A non-actionable follow-up is stored for diagnostics but must never
      // close, replace, or reset an earlier actionable incident.
      const plan = planInboundIncident(prior, candidate, classification, env.AI_CONFIDENCE_THRESHOLD);
      if (plan.action !== 'upsert') {
        processed++;
        continue;
      }
      const { error } = prior
        ? await db.from('sla_incidents').update(plan.incident).eq('id', prior.id)
        : await db.from('sla_incidents').insert(plan.incident);
      if (error) throw error;
    } else if (humanOutbound) {
      const { data: state, error: stateErr } = await db.from('sla_incidents')
        .select('id,latest_inbound_at').eq('company_id', companyRow.id)
        .eq('conversation_id', m.conversationId).eq('status', 'open').maybeSingle();
      if (stateErr) throw stateErr;
      if (state?.latest_inbound_at && Date.parse(m.dateAdded) >= Date.parse(state.latest_inbound_at)) {
        const { error } = await db.from('sla_incidents').update({
          status: 'resolved',
          resolved_at: m.dateAdded,
          resolved_by_message_id: m.id,
          last_human_outbound_at: m.dateAdded,
          updated_at: new Date().toISOString()
        }).eq('id', state.id);
        if (error) throw error;
      }
    }
    processed++;
  }
  return processed;
}
