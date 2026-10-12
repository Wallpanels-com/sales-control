import { describe, expect, it } from 'vitest';
import { buildConversationUrl, incidentStillAllowsAlert } from './alertSafety.js';

const template = 'https://app.gohighlevel.com/v2/location/{locationId}/conversations/conversations/{conversationId}?category=team-inbox&tab=all';

describe('buildConversationUrl', () => {
  it('keeps the exact conversation path and searches by a real customer name', () => {
    const url = new URL(buildConversationUrl(template, {
      locationId: 'location', conversationId: 'conversation', contactId: 'contact', contactName: 'Jodi Rich'
    })!);
    expect(url.pathname).toContain('/conversations/conversations/conversation');
    expect(url.searchParams.get('query')).toBe('Jodi Rich');
  });

  it('does not turn an unknown contact ID into an inbox text search', () => {
    const url = new URL(buildConversationUrl(template, {
      locationId: 'location', conversationId: 'conversation', contactId: 'opaque-contact-id', contactName: 'Unknown contact'
    })!);
    expect(url.searchParams.has('query')).toBe(false);
  });
});

describe('incidentStillAllowsAlert', () => {
  const snapshot = { latest_inbound_message_id: 'inbound-1' };

  it('blocks every later alert after a human reply resolves the incident', () => {
    expect(incidentStillAllowsAlert(snapshot, {
      status: 'resolved', latest_inbound_message_id: 'inbound-1'
    })).toBe(false);
  });

  it('blocks an alert for an older inbound after a newer message replaces it', () => {
    expect(incidentStillAllowsAlert(snapshot, {
      status: 'open', latest_inbound_message_id: 'inbound-2'
    })).toBe(false);
  });
});
