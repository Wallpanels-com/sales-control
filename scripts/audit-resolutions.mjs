// Read-only review of historical resolutions. Never imports Telegram or sends messages.
import { companies, env } from '../dist/config.js';
import { HighLevelClient } from '../dist/highlevel/client.js';
import { isHumanOutbound } from '../dist/services/classification.js';
import { verifiedIncidentHistory } from '../dist/services/alertSafety.js';
import { createClient } from '@supabase/supabase-js';
const apply = process.argv.includes('--apply');
const cutover = process.argv.find(value=>value.startsWith('--cutover='))?.slice('--cutover='.length) || env.PRODUCTION_CUTOVER_AT;
if (apply && !Number.isFinite(Date.parse(cutover))) throw new Error('A verified production cutover is required');
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data: rows, error } = await db.from('message_events').select('company_id,message_id,raw')
  .eq('is_human_outbound',true).or('channel.eq.Other:INTERNAL_COMMENT,raw->>status.in.(failed,undelivered,pending,scheduled,opt_out,canceled,cancelled,draft)');
if (error) throw new Error('Cannot load suspect resolution metadata');
const { data: companyRows } = await db.from('companies').select('id,slug');
const { data: users } = await db.from('ghl_users').select('company_id,ghl_user_id');
const { data: incidents, error: incidentError } = await db.from('sla_incidents')
  .select('id,company_id,conversation_id,contact_id,latest_inbound_message_id,resolved_by_message_id,resolved_at,last_human_outbound_at,latest_inbound_at')
  .eq('status','resolved').in('resolved_by_message_id', rows.map(row=>row.message_id));
if (incidentError) throw new Error('Cannot load suspect incidents');
if (incidents.length > 25) throw new Error('Unexpected repair scope; stopped');
const { ingestMessages } = apply ? await import('../dist/services/messageState.js') : {};
const check = result => { if (result.error) throw new Error('Audit database update failed'); return result; };
if (apply) {
  for (const row of rows) {
    check(await db.from('message_events').update({is_human_outbound:false})
      .eq('company_id',row.company_id).eq('message_id',row.message_id));
  }
}
for (const incident of incidents) {
  const company = companies.find(company=>company.slug === companyRows.find(row=>row.id===incident.company_id)?.slug);
  if (!company) continue;
  const client = new HighLevelClient(company);
  try {
    const conversation = await client.getConversation(incident.conversation_id,1);
    if (conversation.locationId !== company.locationId || conversation.contactId !== incident.contact_id) throw new Error('scope mismatch');
    const history = verifiedIncidentHistory(await client.getConversationMessages(incident.conversation_id,incident.latest_inbound_message_id),
      {locationId:company.locationId,conversationId:incident.conversation_id,contactId:incident.contact_id,inboundMessageId:incident.latest_inbound_message_id});
    const humans = new Set(users.filter(user=>user.company_id===incident.company_id).map(user=>user.ghl_user_id));
    const replies = history.filter(message=>isHumanOutbound(message,humans)).sort((a,b)=>Date.parse(a.dateAdded)-Date.parse(b.dateAdded));
    let correction = 'read_only';
    if (apply) {
      // Persist real CRM evidence first. This function has no Telegram sender.
      await ingestMessages(company,history);
      const { data: currentOpen, error: openError } = await db.from('sla_incidents').select('id')
        .eq('company_id',incident.company_id).eq('conversation_id',incident.conversation_id).eq('status','open').maybeSingle();
      if (openError) throw new Error('Cannot verify current incident state');
      const { data: anchorEvent, error: anchorError } = await db.from('message_events')
        .select('ai_needs_reply,ai_confidence').eq('company_id',incident.company_id).eq('message_id',incident.latest_inbound_message_id).single();
      if (anchorError) throw new Error('Cannot verify stored classification');
      const baseline = Date.parse(incident.latest_inbound_at)<Date.parse(cutover);
      const suppressed = anchorEvent.ai_needs_reply===false && Number(anchorEvent.ai_confidence)>=env.AI_CONFIDENCE_THRESHOLD;
      if (replies.length) {
        check(await db.from('sla_incidents').update({resolved_by_message_id:replies[0].id,
          resolved_at:replies[0].dateAdded,last_human_outbound_at:replies[0].dateAdded,updated_at:new Date().toISOString()})
          .eq('id',incident.id).eq('status','resolved').eq('resolved_by_message_id',incident.resolved_by_message_id));
        correction='real_reply_recorded';
      } else if (!currentOpen && !baseline && !suppressed) {
        const result = await db.from('sla_incidents').update({status:'open',resolved_at:null,resolved_by_message_id:null,
          last_human_outbound_at:null,updated_at:new Date().toISOString()})
          .eq('id',incident.id).eq('status','resolved').eq('resolved_by_message_id',incident.resolved_by_message_id);
        if (result.error?.code !== '23505') check(result);
        correction=result.error ? 'superseded_by_concurrent_inbound' : 'unanswered_restored';
      } else {
        check(await db.from('sla_incidents').update({resolved_by_message_id:null,updated_at:new Date().toISOString()})
          .eq('id',incident.id).eq('status','resolved').eq('resolved_by_message_id',incident.resolved_by_message_id));
        correction=baseline?'preproduction_baseline':suppressed?'ai_nonactionable':'superseded_by_current_incident';
      }
      check(await db.from('system_logs').insert({level:'info',event_type:'audit_resolution_corrected',company_id:incident.company_id,
        conversation_id:incident.conversation_id,contact_id:incident.contact_id,details:{incident_id:incident.id,correction,
          previous_resolved_by_message_id:incident.resolved_by_message_id,previous_resolved_at:incident.resolved_at,
          previous_last_human_outbound_at:incident.last_human_outbound_at}}));
    }
    console.log(JSON.stringify({ incidentId:incident.id, company:company.slug, inboundAt:incident.latest_inbound_at,
      verified:true, correction, realHumanReplies:replies.length, firstRealReplyAt:replies[0]?.dateAdded || null }));
  } catch (error) {
    console.log(JSON.stringify({ incidentId:incident.id,company:company.slug,verified:false,
      error:error instanceof Error?error.message.replace(/\/conversations\/[^/ ]+/g,'/conversations/[redacted]'):'unavailable' }));
  }
}
