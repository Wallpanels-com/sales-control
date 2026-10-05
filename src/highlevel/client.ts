import type { CompanyConfig, ConversationDetails, GhlMessage, GhlOpportunity, GhlUser } from '../types.js';

const BASE = 'https://services.leadconnectorhq.com';

export class HighLevelClient {
  constructor(private readonly company: CompanyConfig) {}

  private async request<T>(path: string, opts?: { version?: string; query?: Record<string, string | number | undefined> }): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [key, val] of Object.entries(opts?.query || {})) {
      if (val !== undefined && val !== '') url.searchParams.set(key, String(val));
    }
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(20_000),
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.company.apiToken}`,
            Version: opts?.version || 'v3'
          }
        });
        if (res.ok) return res.json() as Promise<T>;
        // Response bodies can contain customer data or credentials. Keep logs status-only.
        lastError = new Error(`GHL ${res.status} on GET ${path}`);
        if (res.status !== 429 && res.status < 500) throw lastError;
        const retryAfter = Number(res.headers.get('retry-after') || '0');
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 12000);
        await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 60_000)));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('GHL ') && !/GHL (429|5\d\d)/.test(error.message)) throw error;
        lastError = error instanceof Error ? error : new Error('GHL network error');
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 12000)));
      }
    }
    throw lastError || new Error(`GHL request failed: ${path}`);
  }

  async getLocation(): Promise<any> {
    return this.request(`/locations/${encodeURIComponent(this.company.locationId)}`, { version: '2023-02-21' });
  }

  async searchUsers(companyId: string): Promise<GhlUser[]> {
    const users: GhlUser[] = [];
    for (let skip = 0; skip < 10_000; skip += 100) {
      const data = await this.request<{ users: GhlUser[]; count?: number }>('/users/search', {
        query: { companyId, locationId: this.company.locationId, limit: 100, skip }
      });
      users.push(...(data.users || []));
      if ((data.users || []).length < 100 || (data.count !== undefined && users.length >= data.count)) return users;
    }
    throw new Error('GHL users pagination limit reached');
  }

  async exportMessages(params: { startDate: string; endDate: string; email?: boolean; limit?: number }): Promise<GhlMessage[]> {
    const all: GhlMessage[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const data = await this.request<{ messages: GhlMessage[]; nextCursor?: string | null }>('/conversations/messages/export', {
        version: '2021-04-15',
        query: {
          locationId: this.company.locationId,
          channel: params.email ? 'Email' : undefined,
          startDate: params.startDate,
          endDate: params.endDate,
          sortBy: 'createdAt',
          sortOrder: 'asc',
          limit: params.limit || 1000,
          cursor
        }
      });
      all.push(...(data.messages || []));
      if (!data.nextCursor) return all;
      cursor = data.nextCursor;
    }
    throw new Error('GHL message export pagination limit reached; refusing to skip messages');
  }

  async getConversation(conversationId: string): Promise<ConversationDetails> {
    return this.request(`/conversations/${encodeURIComponent(conversationId)}`);
  }

  async getContact(contactId: string): Promise<any> {
    const data = await this.request<{ contact: any }>(`/contacts/${encodeURIComponent(contactId)}`);
    return data.contact;
  }

  async getOpenOpportunities(contactId: string): Promise<GhlOpportunity[]> {
    const opportunities: GhlOpportunity[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = await this.request<{ opportunities: GhlOpportunity[]; meta?: { total?: number } }>('/opportunities/search', {
        query: { locationId: this.company.locationId, contactId, status: 'open', limit: 100, page }
      });
      opportunities.push(...(data.opportunities || []));
      if ((data.opportunities || []).length < 100 || (data.meta?.total !== undefined && opportunities.length >= data.meta.total)) return opportunities;
    }
    throw new Error('GHL opportunity pagination limit reached');
  }
}
