import { db } from '../db.js';
import { env, followupCutoverAtMs } from '../config.js';
import type { GhlMessage } from '../types.js';
import { advanceFollowup, type FollowupState } from './followupPolicy.js';

export async function trackFollowupEvent(companyId: string, message: GhlMessage, channel: string, human: boolean, attempt = 0): Promise<void> {
  if (env.FOLLOWUP_MODE === 'off' || followupCutoverAtMs === null
    || Date.parse(message.dateAdded) < followupCutoverAtMs) return;
  if (message.direction === 'outbound' && (!human || ['failed','undelivered','scheduled','pending','opt_out'].includes(message.status || ''))) return;
  const { data: current, error } = await db.from('followup_threads').select('*')
    .eq('company_id', companyId).eq('conversation_id', message.conversationId).maybeSingle();
  if (error) throw error;
  let previousInboundId: string | undefined;
  if (message.direction === 'outbound') {
    const { data: inbound, error: lookupError } = await db.from('message_events').select('message_id')
      .eq('company_id', companyId).eq('conversation_id', message.conversationId).eq('direction','inbound')
      .lte('date_added', message.dateAdded).order('date_added',{ ascending: false }).limit(1).maybeSingle();
    if (lookupError) throw lookupError;
    previousInboundId = inbound?.message_id;
  }
  const next = advanceFollowup(current as FollowupState | null, {
    id: message.id, at: message.dateAdded, direction: message.direction, human, channel, previousInboundId
  });
  if (!next) return;
  const payload = {
    ...next, company_id: companyId, conversation_id: message.conversationId, contact_id: message.contactId,
    updated_at: new Date().toISOString()
  };
  // A concurrent delivery can mark this row reminded while polling is writing.
  // Recompute against its fresh status instead of losing that transition.
  const { data: saved, error: saveError } = current
    ? await db.from('followup_threads').update(payload).eq('id',current.id)
      .eq('last_event_key',current.last_event_key).eq('status',current.status).select('id')
    : await db.from('followup_threads').insert(payload).select('id');
  if ((saveError?.code === '23505' || (!saveError && !saved?.length)) && attempt < 2) {
    return trackFollowupEvent(companyId,message,channel,human,attempt+1);
  }
  if (saveError) throw saveError;
  if (!saved?.length) throw new Error('Concurrent follow-up state update deferred');
}
