import type { GhlMessage } from '../types.js';

const CHANNELS: Record<string, string> = {
  SMS: 'SMS', EMAIL: 'Email', WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook', FACEBOOK_MESSENGER: 'Facebook', MESSENGER: 'Facebook',
  WEBCHAT: 'WebChat', WEB_CHAT: 'WebChat', LIVECHAT: 'WebChat', LIVE_CHAT: 'WebChat',
  CHAT_WIDGET: 'WebChat', CHATWIDGET: 'WebChat', GMB: 'GMB', GOOGLE_MY_BUSINESS: 'GMB'
};
// Live Verona and WallPanels exports identify manually sent messages with
// source=app. HighLevel omits userId on some manual Email, Instagram and
// Facebook replies, so a missing ID cannot disqualify an otherwise manual
// reply. If HighLevel does provide an ID, it must belong to a known GHL user.
// Keep source as an allowlist: workflow/API/AI messages must never resolve SLA.
const HUMAN_SOURCES = new Set(['app']);

export function normalizeChannel(m: GhlMessage): string | null {
  if (m.direction !== 'inbound' && m.direction !== 'outbound') return null;
  const type = (m.messageType || '').replace(/^TYPE_/i, '').trim().toUpperCase();
  // Export without a channel also contains calls and CRM activity records.
  if (/(?:^|_)(?:CALL|VOICEMAIL)(?:_|$)/.test(type)
    || /^(?:CAMPAIGN_|OPPORTUNITY(?:_|$)|APPOINTMENT(?:_|$)|INVOICE(?:_|$)|PAYMENT(?:_|$)|TASK(?:_|$)|NOTE(?:_|$)|ACTIVITY(?:_|$))/.test(type)
    || /_(?:REVIEW|NO_SHOW)_REQUEST$/.test(type)) return null;
  if (CHANNELS[type]) return CHANNELS[type];
  // New HighLevel customer channels are accepted when they carry an actual
  // message or attachment, and kept visible under their original type.
  if (m.body?.trim() || m.attachments?.length || m.files?.length) return `Other:${type || 'Unspecified'}`;
  return null;
}

export function isCustomerCommunication(m: GhlMessage): boolean {
  return normalizeChannel(m) !== null;
}

export function isHumanOutbound(m: GhlMessage, humans: Set<string>): boolean {
  if (m.direction !== 'outbound') return false;
  const source = (m.source || '').toLowerCase().replace(/[ -]/g, '_');
  if (!HUMAN_SOURCES.has(source)) return false;
  return !m.userId || humans.has(m.userId);
}
