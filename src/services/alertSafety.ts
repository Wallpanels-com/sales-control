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
