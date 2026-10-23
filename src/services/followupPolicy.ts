import type { AlertRecipient } from './recipients.js';
import { productionRecipients } from './recipients.js';

export const FOLLOWUP_DELAYS_MS = [24, 48, 96].map(hours => hours * 3600_000);
export interface FollowupState {
  cycle_inbound_message_id: string;
  anchor_message_id: string;
  anchor_at: string;
  channel: string;
  stage: number;
  status: 'waiting' | 'reminded' | 'replied' | 'suppressed' | 'completed';
  due_at: string;
  reminded_at: string | null;
  last_event_key: string;
}
export interface FollowupEvent {
  id: string;
  at: string;
  direction: 'inbound' | 'outbound';
  human: boolean;
  channel: string;
  previousInboundId?: string;
}
export function followupEventKey(event: FollowupEvent): string {
  return `${new Date(event.at).toISOString()}:${event.direction === 'inbound' ? 0 : 1}:${event.id}`;
}
export function advanceFollowup(current: FollowupState | null, event: FollowupEvent): FollowupState | null {
  const key = followupEventKey(event);
  if (current && key <= current.last_event_key) return null;
  if (event.direction === 'inbound') {
    return current ? { ...current, status: 'replied', last_event_key: key } : null;
  }
  if (!event.human || !event.previousInboundId) return null;
  const newCycle = !current || current.status === 'replied'
    || current.cycle_inbound_message_id !== event.previousInboundId;
  let stage = newCycle ? 1 : current.stage;
  let status: FollowupState['status'] = 'waiting';
  if (!newCycle && current.status === 'completed') return { ...current, last_event_key: key };
  if (!newCycle && current.status === 'reminded') {
    // Only a manual message actually sent AFTER notification advances the chain.
    if (!current.reminded_at || Date.parse(event.at) <= Date.parse(current.reminded_at)) {
      return { ...current, last_event_key: key };
    }
    if (stage === 3) status = 'completed';
    else stage++;
  }
  return {
    cycle_inbound_message_id: event.previousInboundId,
    anchor_message_id: event.id, anchor_at: event.at, channel: event.channel,
    stage, status, due_at: new Date(Date.parse(event.at) + FOLLOWUP_DELAYS_MS[stage - 1]).toISOString(),
    reminded_at: null, last_event_key: key
  };
}
export function followupRecipients(mode: 'off'|'preview'|'production', owner: AlertRecipient | null,
  globals: AlertRecipient[], testRecipient: AlertRecipient | null): AlertRecipient[] {
  if (mode === 'preview') return testRecipient?.telegram_chat_id ? [testRecipient] : [];
  return mode === 'production' ? productionRecipients(owner, globals) : [];
}
