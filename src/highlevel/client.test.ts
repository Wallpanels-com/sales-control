import { afterEach, describe, expect, it, vi } from 'vitest';
import { HighLevelClient } from './client.js';
import type { CompanyConfig } from '../types.js';
import { verifiedIncidentHistory } from '../services/alertSafety.js';
import { isHumanOutbound } from '../services/classification.js';

const company: CompanyConfig = {
  slug: 'verona', displayName: 'Verona Home', locationId: 'location-test', apiToken: 'test-token'
};

afterEach(() => vi.unstubAllGlobals());

describe('HighLevel export requests', () => {
  it('fetches all non-email channels without channel and Email separately', async () => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
      urls.push(new URL(input));
      return { ok: true, json: async () => ({ messages: [] }) };
    }));

    const client = new HighLevelClient(company);
    const window = { startDate: '2026-10-05T00:00:00Z', endDate: '2026-10-05T01:00:00Z' };
    await client.exportMessages({ ...window, email: false });
    await client.exportMessages({ ...window, email: true });

    expect(urls).toHaveLength(2);
    expect(urls.map(url => url.pathname)).toEqual(['/conversations/messages/export', '/conversations/messages/export']);
    expect(urls[0].searchParams.has('channel')).toBe(false);
    expect(urls[1].searchParams.get('channel')).toBe('Email');
  });

  it('does not retry a rate-limited export when one attempt is requested', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new HighLevelClient(company);
    await expect(client.exportMessages({
      startDate: '2026-10-05T00:00:00Z', endDate: '2026-10-05T01:00:00Z', maxAttempts: 1
    })).rejects.toThrow('GHL 429');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('email history verification with real API thread shape', () => {
  const base = { locationId: company.locationId, contactId: 'contact', conversationId: 'conversation',
    messageType: 'TYPE_EMAIL', dateAdded: '2026-11-14T15:49:08Z', direction: 'inbound' };

  it('expands email IDs instead of confusing the thread ID with the customer message', async () => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
      const url = new URL(input);
      urls.push(url);
      const payload = url.pathname.endsWith('/messages')
        ? { messages: { nextPage: true, lastMessageId: 'thread', messages: [
          { ...base, id: 'thread', source: 'workflow', meta: { email: { messageIds: ['customer-email', 'human-email', 'workflow-email'] } } }
        ] } }
        : { emailMessage: { ...base, id: url.pathname.split('/').pop(),
          dateAdded: url.pathname.endsWith('customer-email') ? '2026-11-14T15:49:03Z' : '2026-11-14T16:00:00Z',
          direction: url.pathname.endsWith('customer-email') ? 'inbound' : 'outbound',
          source: url.pathname.endsWith('workflow-email') ? 'workflow' : 'app', userId: 'sales', body: 'Email text' } };
      return { ok: true, json: async () => payload };
    }));
    const messages = await new HighLevelClient(company).getConversationMessages('conversation', 'customer-email');
    const verified = verifiedIncidentHistory(messages, { locationId: company.locationId,
      contactId: 'contact', conversationId: 'conversation', inboundMessageId: 'customer-email' });
    expect(verified.map(message => message.id)).toContain('customer-email');
    expect(verified.find(message => message.id === 'customer-email')?.dateAdded).toBe('2026-11-14T15:49:03Z');
    expect(isHumanOutbound(verified.find(message => message.id === 'human-email')!, new Set(['sales']))).toBe(true);
    expect(isHumanOutbound(verified.find(message => message.id === 'workflow-email')!, new Set(['sales']))).toBe(false);
    expect(urls).toHaveLength(4);
  });

  it('rejects an email returned from a different company or client', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL) => ({ ok: true, json: async () =>
      new URL(input).pathname.endsWith('/messages')
        ? { messages: { nextPage: false, messages: [{ ...base, id: 'thread', meta: { email: { messageIds: ['email'] } } }] } }
        : { emailMessage: { ...base, id: 'email', locationId: 'other-location' } }
    })));
    await expect(new HighLevelClient(company).getConversationMessages('conversation', 'email'))
      .rejects.toThrow('scope verification');
  });
});
