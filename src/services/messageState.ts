import { db } from '../db.js';
import type { CompanyConfig, GhlMessage } from '../types.js';
import { isCustomerCommunication, isHumanOutbound, normalizeChannel } from './classification.js';

async function knownHumanUserIds(companyId: string): Promise<Set<string>> {
  const { data, error } = await db.from('ghl_users').select('ghl_user_id').eq('company_id', companyId);
  if (error) throw error;
  return new Set((data || []).map((r: any) => r.ghl_user_id));
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
    }, { onConflict: 'company_id,message_id', ignoreDuplicates: true });
    if (insertErr) throw insertErr;

    if (m.direction === 'inbound') {
      const { data: recordedIncident, error: recordedError } = await db.from('sla_incidents')
        .select('id').eq('company_id', companyRow.id).eq('latest_inbound_message_id', m.id).maybeSingle();
      if (recordedError) throw recordedError;
      if (recordedIncident) continue;

      const { data: prior, error: priorErr } = await db.from('sla_incidents')
        .select('id,latest_inbound_at').eq('company_id', companyRow.id)
        .eq('conversation_id', m.conversationId).eq('status', 'open').maybeSingle();
      if (priorErr) throw priorErr;
      if (prior && Date.parse(prior.latest_inbound_at) > Date.parse(m.dateAdded)) continue;
      const incident = {
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
      const { error } = prior
        ? await db.from('sla_incidents').update(incident).eq('id', prior.id)
        : await db.from('sla_incidents').insert(incident);
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
