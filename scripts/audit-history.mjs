// Read-only audit. Does not import/start the bot, call AI, or send messages.
import { companies, env } from '../dist/config.js';
import { HighLevelClient } from '../dist/highlevel/client.js';
import { createClient } from '@supabase/supabase-js';
import { verifiedIncidentHistory } from '../dist/services/alertSafety.js';

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data: companyRows, error: companyError } = await db.from('companies').select('id,slug');
if (companyError) throw new Error('Cannot read company metadata');
for (const company of companies) {
  const row = companyRows.find(row => row.slug === company.slug);
  const { data: incidents, error } = await db.from('sla_incidents')
    .select('id,conversation_id,contact_id,latest_inbound_message_id,latest_inbound_at,channel')
    .eq('company_id', row.id).eq('status','open').order('latest_inbound_at', { ascending: false }).limit(100);
  if (error) throw new Error('Cannot read incident metadata');
  const { data: alerts, error: alertError } = await db.from('alerts')
    .select('incident_id,inbound_message_id,threshold_minutes,delivery_status')
    .in('incident_id', incidents.map(incident => incident.id));
  if (alertError) throw new Error('Cannot read alert metadata');
  const pending = incidents.filter(incident => !alerts.some(alert => alert.incident_id === incident.id
    && alert.inbound_message_id === incident.latest_inbound_message_id && alert.threshold_minutes === 120 && alert.delivery_status === 'sent'));
  const client = new HighLevelClient(company);
  for (const incident of pending.slice(0, 3)) {
    try {
      const conversation = await client.getConversation(incident.conversation_id, 1);
      const messages = await client.getConversationMessages(incident.conversation_id, incident.latest_inbound_message_id);
      const scope = messages.filter(message => message.locationId === company.locationId
        && message.contactId === incident.contact_id && message.conversationId === incident.conversation_id);
      const anchor = messages.find(message => message.id === incident.latest_inbound_message_id);
      const alternate = messages.find(message => message.altId === incident.latest_inbound_message_id
        || message.meta?.email?.messageIds?.includes(incident.latest_inbound_message_id));
      let anchorVerified = false;
      try {
        anchorVerified = verifiedIncidentHistory(messages, { locationId: company.locationId, contactId: incident.contact_id,
          conversationId: incident.conversation_id, inboundMessageId: incident.latest_inbound_message_id }).length > 0;
      } catch {}
      const { data: stored } = await db.from('message_events').select('raw')
        .eq('company_id',row.id).eq('message_id',incident.latest_inbound_message_id).single();
      console.log(JSON.stringify({ company: company.slug, channel: incident.channel, at: incident.latest_inbound_at,
        conversationValid: conversation.locationId === company.locationId && conversation.contactId === incident.contact_id,
        returned: messages.length, scoped: scope.length, anchorVerified, exactAnchor: Boolean(anchor), alternateAnchor: Boolean(alternate),
        aliasKind: alternate?.altId === incident.latest_inbound_message_id ? 'altId' : 'meta.email.messageIds',
        aliasDate: alternate?.dateAdded, aliasDirection: alternate?.direction,
        emailMetaFields: Object.keys(alternate?.meta?.email || {}),
        metaMessageCount: alternate?.meta?.email?.messageIds?.length,
        storedRawFields: Object.keys(stored?.raw || {}),
        storedAliasMatchesHistoryId: stored?.raw?.altId === alternate?.id,
        storedDate: stored?.raw?.dateAdded }));
    } catch (error) {
      console.log(JSON.stringify({ company: company.slug, channel: incident.channel, at: incident.latest_inbound_at,
        error: error instanceof Error ? error.message.replace(/\/conversations\/[^/ ]+/g, '/conversations/[redacted]') : 'unavailable' }));
    }
  }
}
