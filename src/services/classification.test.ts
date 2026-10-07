import { describe, expect, it } from 'vitest';
import { isCustomerCommunication, isHumanOutbound, normalizeChannel } from './classification.js';
import type { GhlMessage } from '../types.js';

const base: GhlMessage = {
  id: 'message-1', locationId: 'location-1', contactId: 'contact-1', conversationId: 'conversation-1',
  dateAdded: '2026-10-05T12:00:00Z', direction: 'outbound', messageType: 'SMS', userId: 'user-1'
};

describe('HighLevel message classification', () => {
  it('normalizes all supported customer channels', () => {
    for (const [messageType, channel] of Object.entries({
      SMS:'SMS', 'TYPE_SMS':'SMS', Email:'Email', WhatsApp:'WhatsApp', Instagram:'Instagram',
      Facebook:'Facebook', Webchat:'WebChat', LIVE_CHAT:'WebChat', GMB:'GMB'
    })) {
      expect(normalizeChannel({ ...base, messageType })).toBe(channel);
    }
  });

  it('accepts new text and attachment channels while excluding calls and CRM activity', () => {
    expect(normalizeChannel({ ...base, direction:'inbound', messageType:'TYPE_CUSTOM_CHAT', body:'Hello' })).toBe('Other:CUSTOM_CHAT');
    expect(normalizeChannel({ ...base, direction:'inbound', messageType:'TYPE_VOICE_NOTE', body:undefined, attachments:['attachment'] })).toBe('Other:VOICE_NOTE');
    expect(normalizeChannel({ ...base, direction:'inbound', messageType:'TYPE_NEW_INBOX', body:undefined, files:['file'] })).toBe('Other:NEW_INBOX');
    for (const messageType of ['CALL','TYPE_MISSED_CALL','TYPE_CALL_RECORDING','TYPE_VOICEMAIL','TYPE_CAMPAIGN_SMS','TYPE_APPOINTMENT']) {
      expect(isCustomerCommunication({ ...base, direction:'inbound', messageType, body:'Missed call' })).toBe(false);
    }
    expect(normalizeChannel({ ...base, messageType:'TYPE_UNKNOWN', body:undefined, attachments:[] })).toBe(null);
  });

  it('resolves manual app replies while rejecting automation and unknown supplied users', () => {
    const humans = new Set(['user-1']);
    for (const messageType of ['TYPE_SMS','TYPE_EMAIL','TYPE_WHATSAPP','TYPE_INSTAGRAM','TYPE_FACEBOOK','TYPE_WEBCHAT']) {
      expect(isHumanOutbound({ ...base, messageType, source:'app' }, humans)).toBe(true);
    }
    for (const messageType of ['TYPE_EMAIL','TYPE_INSTAGRAM','TYPE_FACEBOOK']) {
      expect(isHumanOutbound({ ...base, messageType, source:'app', userId: undefined }, humans)).toBe(true);
    }
    expect(isHumanOutbound({ ...base, userId: 'unknown' }, humans)).toBe(false);
    expect(isHumanOutbound({ ...base, direction: 'inbound' }, humans)).toBe(false);
    for (const source of ['workflow','Campaign','bulk actions','api','conversation_ai','bot',undefined,'unknown']) {
      expect(isHumanOutbound({ ...base, source }, humans)).toBe(false);
      expect(isHumanOutbound({ ...base, source, userId: undefined }, humans)).toBe(false);
    }
  });
});
