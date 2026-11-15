// Read-only: distinguish a deleted CRM conversation from an API authorization failure.
import { companies, env } from '../dist/config.js';
import { createClient } from '@supabase/supabase-js';
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const company = companies.find(company=>company.slug==='wallpanels');
const { data: incident, error } = await db.from('sla_incidents').select('conversation_id,contact_id')
  .eq('conversation_id','UBBb51bq9HMD6xNGQlKj').eq('status','open').single();
if (error) throw new Error('Known unavailable incident not found');
const headers={Authorization:`Bearer ${company.apiToken}`,Version:'v3',Accept:'application/json'};
const response=await fetch(`https://services.leadconnectorhq.com/conversations/${encodeURIComponent(incident.conversation_id)}`,{headers});
const value=await response.json();
const message=typeof value.message==='string'?value.message:'';
const contact=await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(incident.contact_id)}`,{headers});
console.log(JSON.stringify({conversationStatus:response.status,errorFields:Object.keys(value),
  confirmedNotFound:/not found|does not exist|not exist/i.test(message),contactStatus:contact.status}));
