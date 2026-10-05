import { db } from '../db.js';

export async function writeSystemLog(args: {
  level: 'info' | 'warn' | 'error';
  eventType: string;
  companyId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db.from('system_logs').insert({
    level: args.level,
    event_type: args.eventType,
    company_id: args.companyId || null,
    conversation_id: args.conversationId || null,
    contact_id: args.contactId || null,
    details: args.details || {}
  });
  if (error) console.error('System log persistence failed', { eventType: args.eventType, code: error.code });
}
