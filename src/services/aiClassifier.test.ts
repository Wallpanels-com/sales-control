import { describe, expect, it, vi } from 'vitest';
import { GroqInboundClassifier, suppressesSlaIncident } from './aiClassifier.js';

function response(result: unknown, status = 200): Response {
  return new Response(JSON.stringify(status === 200
    ? { choices: [{ message: { content: JSON.stringify(result) } }] }
    : { error: 'unavailable' }), { status, headers: { 'content-type': 'application/json' } });
}

function classifier(fetchFn: typeof fetch) {
  return new GroqInboundClassifier({
    apiKey: 'test-key', model: 'openai/gpt-oss-20b', timeoutMs: 1000, fetchFn
  });
}

describe('Groq inbound classification safety', () => {
  it('suppresses a pure acknowledgement only at high confidence', async () => {
    const fetchFn = vi.fn(async () => response({ needs_reply: false, confidence: 0.95, reason: 'pure acknowledgement' }));
    const result = await classifier(fetchFn).classify('Thank you!', []);
    expect(suppressesSlaIncident(result, 0.90)).toBe(true);
  });

  it('keeps a request under SLA', async () => {
    const fetchFn = vi.fn(async () => response({ needs_reply: true, confidence: 0.99, reason: 'asks for a quote' }));
    const result = await classifier(fetchFn).classify('Thanks, can you send the quote?', []);
    expect(result.needsReply).toBe(true);
    expect(suppressesSlaIncident(result, 0.90)).toBe(false);
  });

  it('falls back to needs_reply=true on API failure', async () => {
    const result = await classifier(vi.fn(async () => response({}, 500))).classify('Hello', []);
    expect(result).toMatchObject({ needsReply: true, confidence: 0, reason: 'fallback: http_500' });
  });

  it('does not suppress a low-confidence false result', async () => {
    const fetchFn = vi.fn(async () => response({ needs_reply: false, confidence: 0.70, reason: 'possibly acknowledgement' }));
    const result = await classifier(fetchFn).classify('Okay', []);
    expect(suppressesSlaIncident(result, 0.90)).toBe(false);
  });

  it('falls back safely on invalid JSON', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), { status: 200 }));
    const result = await classifier(fetchFn).classify('Hello', []);
    expect(result.needsReply).toBe(true);
    expect(result.reason).toBe('fallback: invalid_or_unavailable');
  });
});
