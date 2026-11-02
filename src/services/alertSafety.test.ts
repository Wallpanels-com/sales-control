import { describe, expect, it } from 'vitest';
import { buildConversationUrl, incidentStillAllowsAlert, syncAllowsAlert, verifiedIncidentHistory } from './alertSafety.js';
import { isHumanOutbound } from './classification.js';
import type { GhlMessage } from '../types.js';

describe('post-outage conversation reconciliation', () => {
  const scope = { locationId: 'wallpanels', conversationId: 'conversation', contactId: 'client', inboundMessageId: 'inbound' };
  const inbound: GhlMessage = { id: 'inbound', locationId: 'wallpanels', conversationId: 'conversation',
    contactId: 'client', direction: 'inbound', messageType: 'TYPE_INSTAGRAM', dateAdded: '2026-10-30T10:00:00Z', body: 'Quote?' };

  it('retains a human reply from outside the rolling export window', () => {
    const reply: GhlMessage = { ...inbound, id: 'reply', direction: 'outbound', source: 'app', dateAdded: '2026-10-30T12:00:00Z' };
    const history = verifiedIncidentHistory([reply, inbound], scope);
    expect(history).toContain(reply);
    expect(history.some(message => isHumanOutbound(message, new Set()))).toBe(true);
  });

  it('does not treat workflow messages, calls or another location as a human reply', () => {
    const outbound: GhlMessage = { ...inbound, id: 'outbound', direction: 'outbound', dateAdded: '2026-10-30T12:00:00Z' };
    const history = verifiedIncidentHistory([inbound,
      { ...outbound, source: 'workflow' },
      { ...outbound, id: 'call', source: 'app', messageType: 'TYPE_CALL' },
      { ...outbound, id: 'other-company', source: 'app', locationId: 'verona' }], scope);
    expect(history.map(message => message.id)).toEqual(['inbound', 'outbound']);
    expect(history.some(message => isHumanOutbound(message, new Set()))).toBe(false);
  });

  it('fails closed when the exact inbound anchor cannot be verified', () => {
    expect(() => verifiedIncidentHistory([], scope)).toThrow('Cannot verify');
    expect(() => verifiedIncidentHistory([{ ...inbound, contactId: 'different-client' }], scope)).toThrow('Cannot verify');
  });
});

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

describe('fresh synchronization gate', () => {
  it('blocks alerts during a failed, incomplete or stale sync', () => {
    expect(syncAllowsAlert(undefined, true, false, 60, 200_000)).toBe(false);
    expect(syncAllowsAlert(190_000, false, false, 60, 200_000)).toBe(false);
    expect(syncAllowsAlert(190_000, true, true, 60, 200_000)).toBe(false);
    expect(syncAllowsAlert(1, true, false, 60, 200_000)).toBe(false);
    expect(syncAllowsAlert(190_000, true, false, 60, 200_000)).toBe(true);
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
