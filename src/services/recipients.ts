export interface AlertRecipient {
  id: string;
  telegram_chat_id?: string | null;
  [key: string]: unknown;
}

export function productionRecipients(
  owner: AlertRecipient | null,
  globalRecipients: AlertRecipient[]
): AlertRecipient[] {
  const unique = new Map<string, AlertRecipient>();
  if (owner?.telegram_chat_id) unique.set(owner.id, owner);
  for (const recipient of globalRecipients) unique.set(recipient.id, recipient);
  return [...unique.values()];
}
