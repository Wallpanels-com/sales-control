import type { GhlMessage } from '../types.js';
import { isCustomerCommunication } from './classification.js';

export function withinSlaNotificationWindow(inboundAt: string, cutoverAt: number | null, now = Date.now()): boolean {
  const at = Date.parse(inboundAt);
  // Recovery must not turn old incidents into a new notification campaign.
  // Normal thresholds remain 60/90/120; permit at most one hour of delay.
  return Number.isFinite(at) && at <= now && now - at <= 180 * 60_000
    && (cutoverAt === null || at >= cutoverAt);
}

export function verifiedIncidentHistory(
  messages: GhlMessage[],
  scope: { locationId: string; conversationId: string; contactId: string; inboundMessageId: string }
): GhlMessage[] {
  const scoped = messages.filter(message => message.locationId === scope.locationId
    && message.conversationId === scope.conversationId && message.contactId === scope.contactId
    && isCustomerCommunication(message) && Number.isFinite(Date.parse(message.dateAdded)));
  const anchor = scoped.find(message => message.id === scope.inboundMessageId && message.direction === 'inbound');
  if (!anchor) throw new Error('Cannot verify SLA inbound in current CRM history');
  return scoped.filter(message => Date.parse(message.dateAdded) >= Date.parse(anchor.dateAdded));
}

export function buildConversationUrl(
  template: string | undefined,
  values: { conversationId: string; contactId: string; locationId: string; contactName?: string | null }
): string | null {
  if (!template) return null;
  const contactName = values.contactName?.trim() || '';
  const rendered = template
    .replaceAll('{conversationId}', encodeURIComponent(values.conversationId))
    .replaceAll('{contactId}', encodeURIComponent(values.contactId))
    .replaceAll('{locationId}', encodeURIComponent(values.locationId))
    .replaceAll('{contactName}', encodeURIComponent(contactName));

  const url = new URL(rendered);
  // A contact ID is not a valid inbox text search. When the name is unknown,
  // keep the exact conversation path unfiltered instead of hiding its result.
  if (contactName && contactName !== 'Unknown contact' && !url.searchParams.has('query')) {
    url.searchParams.set('query', contactName);
  }
  return url.toString();
}

export function incidentStillAllowsAlert(
  snapshot: { latest_inbound_message_id: string },
  current: { status: string; latest_inbound_message_id: string }
): boolean {
  return current.status === 'open'
    && current.latest_inbound_message_id === snapshot.latest_inbound_message_id;
}

export function syncAllowsAlert(lastSuccessfulEnd: number | undefined, healthy: boolean, polling: boolean, intervalSeconds: number, now = Date.now()): boolean {
  return healthy && !polling && lastSuccessfulEnd !== undefined
    && now - lastSuccessfulEnd <= Math.max(intervalSeconds * 3, 180) * 1000;
}
