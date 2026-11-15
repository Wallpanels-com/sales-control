// Explicit user-requested retraction of precisely scoped, recent bot messages.
// Never sends messages; keeps Supabase alert history to prevent resend.
import { env } from '../dist/config.js';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const since=process.argv.find(arg=>arg.startsWith('--since='))?.slice(8);
const apply=process.argv.includes('--apply');
const manifest=process.argv.find(arg=>arg.startsWith('--manifest='))?.slice(11);
if(!manifest)throw new Error('An explicit reviewed alert-ID manifest is required');
const allowedIds=JSON.parse(readFileSync(manifest,'utf8'));
if(!Array.isArray(allowedIds)||!allowedIds.length||allowedIds.length>100||allowedIds.some(id=>!/^[-a-f0-9]{36}$/.test(id)))throw new Error('Invalid explicit alert scope');
if (!since || !Number.isFinite(Date.parse(since)) || Date.now()-Date.parse(since)>24*3600_000) throw new Error('A recent explicit start timestamp is required');
const db=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY);
const {data:alerts,error}=await db.from('alerts').select('id,company_id,conversation_id,inbound_message_id,recipient_staff_id,telegram_message_id,sent_at,error_code')
  .in('id',allowedIds).gte('sent_at',since).not('telegram_message_id','is',null).limit(101);
if (error || alerts.length>500) throw new Error('Retraction scope could not be verified');
const {data:events,error:eventsError}=await db.from('message_events').select('company_id,message_id,date_added')
  .in('message_id',[...new Set(alerts.map(alert=>alert.inbound_message_id))]);
const {data:users,error:usersError}=await db.from('telegram_users').select('staff_id,telegram_chat_id');
if(eventsError||usersError)throw new Error('Retraction metadata unavailable');
const targets=alerts.filter(alert=>{
  const event=events.find(event=>event.company_id===alert.company_id&&event.message_id===alert.inbound_message_id);
  return event&&Date.parse(alert.sent_at)-Date.parse(event.date_added)>180*60_000&&alert.error_code!=='retracted_historical_backfill';
});
if(targets.some(alert=>!allowedIds.includes(alert.id)))throw new Error('Target outside approved manifest');
console.log(JSON.stringify({manifestCount:allowedIds.length,verifiedTargets:targets.length,
  minimumWaitingMinutes:Math.min(...targets.map(alert=>{
    const event=events.find(event=>event.company_id===alert.company_id&&event.message_id===alert.inbound_message_id);
    return Math.floor((Date.parse(alert.sent_at)-Date.parse(event.date_added))/60_000);
  })),apply}));
if(apply){
  const me=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
  const identity=await me.json();
  if(!identity.ok||identity.result.username!=='WPVHSalesBot')throw new Error('Corporate bot identity could not be verified');
  let deleted=0,missing=0,failed=0;
  for(const alert of targets){
    const user=users.find(user=>user.staff_id===alert.recipient_staff_id);
    if(!user){failed++;continue;}
    const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({chat_id:user.telegram_chat_id,message_id:Number(alert.telegram_message_id)})});
    const result=await response.json();
    const absent=!result.ok&&result.error_code===400&&/message to delete not found/i.test(result.description||'');
    if(!result.ok&&!absent){failed++;continue;}
    if(absent)missing++;else deleted++;
    const {error:updateError}=await db.from('alerts').update({error_code:'retracted_historical_backfill'}).eq('id',alert.id);
    if(updateError)throw new Error('Retraction audit update failed');
    const {error:logError}=await db.from('system_logs').insert({level:'info',event_type:'historical_alert_retracted',company_id:alert.company_id,
      conversation_id:alert.conversation_id,details:{alert_id:alert.id,telegram_message_id:alert.telegram_message_id,already_absent:absent}});
    if(logError)throw new Error('Retraction logging failed');
  }
  console.log(JSON.stringify({deleted,alreadyAbsent:missing,failed}));
  if(failed)process.exitCode=1;
}
