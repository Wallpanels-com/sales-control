// User-requested deletion of an exact, reviewed set of bot notifications.
// Read-only by default; never sends messages or removes database history.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { env } from '../dist/config.js';
const manifest=process.argv.find(arg=>arg.startsWith('--manifest='))?.slice(11);
const since=process.argv.find(arg=>arg.startsWith('--since='))?.slice(8);
const apply=process.argv.includes('--apply');
if(!manifest||!since||!Number.isFinite(Date.parse(since))||Date.now()-Date.parse(since)>24*3600_000)throw new Error('Explicit recent scope is required');
const ids=JSON.parse(readFileSync(manifest,'utf8'));
if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!/^[-a-f0-9]{36}$/.test(id)))throw new Error('Invalid ID manifest');
const db=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY);
const {data:rows,error}=await db.from('followup_notifications')
  .select('id,company_id,conversation_id,anchor_message_id,stage,recipient_staff_id,telegram_message_id,sent_at')
  .in('id',ids).eq('preview',false).gte('sent_at',since).not('telegram_message_id','is',null);
const {data:events,error:eventsError}=await db.from('message_events').select('company_id,message_id,date_added')
  .in('message_id',[...new Set((rows||[]).map(row=>row.anchor_message_id))]);
const {data:users,error:usersError}=await db.from('telegram_users').select('staff_id,telegram_chat_id');
const {data:logs,error:logsError}=await db.from('system_logs').select('details')
  .eq('event_type','historical_followup_retracted').gte('created_at',since);
if(error||eventsError||usersError||logsError)throw new Error('Scope verification failed');
const targets=rows.filter(row=>{
  const anchor=events.find(event=>event.company_id===row.company_id&&event.message_id===row.anchor_message_id);
  const maxHours={1:30,2:54,3:102}[row.stage];
  return ids.includes(row.id)&&maxHours&&anchor
    &&Date.parse(row.sent_at)-Date.parse(anchor.date_added)>maxHours*3600_000
    &&!logs.some(log=>log.details.notification_id===row.id);
});
console.log(JSON.stringify({manifestCount:ids.length,verifiedOverdueTargets:targets.length,apply}));
if(apply){
  const me=await(await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`)).json();
  if(!me.ok||me.result.username!=='WPVHSalesBot')throw new Error('Corporate bot identity mismatch');
  let deleted=0,missing=0,failed=0;
  for(const row of targets){
    const user=users.find(user=>user.staff_id===row.recipient_staff_id);
    if(!user){failed++;continue;}
    const result=await(await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({chat_id:user.telegram_chat_id,message_id:Number(row.telegram_message_id)})})).json();
    const absent=!result.ok&&result.error_code===400&&/message to delete not found/i.test(result.description||'');
    if(!result.ok&&!absent){failed++;continue;}
    if(absent)missing++;else deleted++;
    const {error}=await db.from('system_logs').insert({level:'info',event_type:'historical_followup_retracted',company_id:row.company_id,
      conversation_id:row.conversation_id,details:{notification_id:row.id,telegram_message_id:row.telegram_message_id,already_absent:absent}});
    if(error)throw new Error('Retraction audit write failed');
  }
  console.log(JSON.stringify({deleted,alreadyAbsent:missing,failed}));
  if(failed)process.exitCode=1;
}
