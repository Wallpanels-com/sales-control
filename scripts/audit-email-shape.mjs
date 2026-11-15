// Read-only inspection of API response fields; no message text or credentials in output.
import { companies, env } from '../dist/config.js';
import { createClient } from '@supabase/supabase-js';
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const company = companies.find(company => company.slug === 'wallpanels');
const { data: row } = await db.from('companies').select('id').eq('slug',company.slug).single();
const { data: incident } = await db.from('sla_incidents').select('conversation_id,contact_id,latest_inbound_message_id')
  .eq('company_id',row.id).eq('status','open').eq('channel','Email').order('latest_inbound_at',{ascending:false}).limit(1).single();
const headers = { Authorization: `Bearer ${company.apiToken}`, Version: 'v3', Accept: 'application/json' };
const history = await fetch(`https://services.leadconnectorhq.com/conversations/${encodeURIComponent(incident.conversation_id)}/messages?limit=100`, {headers});
const data = await history.json();
const parent = data.messages?.messages?.find(message => message.meta?.email?.messageIds?.includes(incident.latest_inbound_message_id));
if (!parent) throw new Error('Email thread not found');
const res = await fetch(`https://services.leadconnectorhq.com/conversations/messages/email/${encodeURIComponent(incident.latest_inbound_message_id)}`, {headers});
const value = await res.json();
for (const [key, email] of Object.entries({ root: value, emailMessage: value.emailMessage })) {
  if (!email || typeof email !== 'object') continue;
  console.log(JSON.stringify({ key, status: res.status, fields: Object.keys(email).sort(), idMatches: email.id === incident.latest_inbound_message_id,
    locationMatches: email.locationId === company.locationId, contactMatches: email.contactId === incident.contact_id,
    conversationMatches: email.conversationId === incident.conversation_id, dateValid: Number.isFinite(Date.parse(email.dateAdded)),
    direction: email.direction, source: email.source, messageType: email.messageType }));
}
