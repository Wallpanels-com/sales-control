// Read-only diagnostics. Never starts polling, changes CRM, or sends Telegram messages.
import { companies, env } from '../dist/config.js';
import { HighLevelClient } from '../dist/highlevel/client.js';
import { createClient } from '@supabase/supabase-js';

try {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const { data: rows, error } = await db.from('companies').select('id,slug,location_id');
  if (error) throw new Error(`Supabase HTTP diagnostic failed: ${error.code || 'unavailable'}`);
  console.log(JSON.stringify({ check: 'supabase', ok: true, companies: rows.length }));
  for (const company of companies) {
    const row = rows.find(row => row.slug === company.slug);
    if (!row || row.location_id !== company.locationId) throw new Error('Company location mismatch');
    const client = new HighLevelClient(company);
    const location = await client.getLocation(1);
    const agencyId = location?.location?.companyId || location?.companyId;
    const users = await client.searchUsers(agencyId, 1);
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 15 * 60_000).toISOString();
    const nonEmail = await client.exportMessages({ startDate, endDate, maxAttempts: 1 });
    const email = await client.exportMessages({ startDate, endDate, email: true, maxAttempts: 1 });
    const { data: incident, error: incidentError } = await db.from('sla_incidents')
      .select('conversation_id,contact_id,latest_inbound_message_id')
      .eq('company_id', row.id).eq('status', 'open').order('latest_inbound_at', { ascending: false }).limit(1).maybeSingle();
    if (incidentError) throw new Error('Incident diagnostic failed');
    let history = [];
    let scopeVerified = null;
    if (incident) {
      const conversation = await client.getConversation(incident.conversation_id, 1);
      scopeVerified = conversation.locationId === company.locationId && conversation.contactId === incident.contact_id;
      history = await client.getConversationMessages(incident.conversation_id, incident.latest_inbound_message_id);
      await client.getContact(incident.contact_id, 1);
      await client.getOpenOpportunities(incident.contact_id, 1);
    }
    console.log(JSON.stringify({ check: company.slug, ok: true, users: users.length,
      nonEmail: nonEmail.length, email: email.length, scopeVerified, historyMessages: history.length,
      historyShapes: [...new Set(history.map(m => JSON.stringify({ fields: Object.keys(m).sort(),
        direction: m.direction, messageType: m.messageType, source: m.source,
        hasLocation: Boolean(m.locationId), hasContact: Boolean(m.contactId), hasConversation: Boolean(m.conversationId) })))].map(s => JSON.parse(s)) }));
  }
  const telegram = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`,
    { signal: AbortSignal.timeout(15_000) });
  const result = await telegram.json();
  console.log(JSON.stringify({ check: 'telegram', ok: telegram.ok && result.ok === true, username: result.result?.username }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Read-only verification failed');
  process.exitCode = 1;
}
