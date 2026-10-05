import { afterEach, describe, expect, it, vi } from 'vitest';
import { HighLevelClient } from './client.js';
import type { CompanyConfig } from '../types.js';

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
});
