import { describe, expect, it } from 'vitest';
import { isProvisionalAiReason, planInboundIncident, shouldResolveRecordedIncident } from './messageState.js';

const actionableIncident = {
  id: 'incident-1',
  latest_inbound_at: '2026-10-07T12:00:00Z',
  latest_inbound_message_id: 'where-is-my-quote',
  status: 'open'
};

const thanksCandidate = {
  latest_inbound_at: '2026-10-07T12:10:00Z',
  latest_inbound_message_id: 'thank-you',
  status: 'open'
};

describe('AI incident protection', () => {
  it('does not create an incident for a high-confidence non-actionable message', () => {
    expect(planInboundIncident(null, thanksCandidate, { needsReply: false, confidence: 0.95 }, 0.90))
      .toEqual({ action: 'ignore' });
  });

  it('cannot close or replace an existing actionable incident', () => {
    expect(planInboundIncident(actionableIncident, thanksCandidate, { needsReply: false, confidence: 0.95 }, 0.90))
      .toEqual({ action: 'preserve' });
    expect(actionableIncident).toMatchObject({
      latest_inbound_at: '2026-10-07T12:00:00Z',
      latest_inbound_message_id: 'where-is-my-quote',
      status: 'open'
    });
  });

  it('keeps low-confidence and error fallbacks actionable', () => {
    expect(planInboundIncident(null, thanksCandidate, { needsReply: false, confidence: 0.70 }, 0.90).action).toBe('upsert');
    expect(planInboundIncident(null, thanksCandidate, { needsReply: true, confidence: 0 }, 0.90).action).toBe('upsert');
  });

  it('retries provisional classifications and closes an already-open false positive', () => {
    expect(isProvisionalAiReason('pre-ai-baseline')).toBe(true);
    expect(isProvisionalAiReason('fallback: timeout')).toBe(true);
    expect(isProvisionalAiReason('pure acknowledgement')).toBe(false);
    expect(shouldResolveRecordedIncident('open', { needsReply: false, confidence: 0.95 }, 0.90)).toBe(true);
    expect(shouldResolveRecordedIncident('open', { needsReply: true, confidence: 0.99 }, 0.90)).toBe(false);
    expect(shouldResolveRecordedIncident('resolved', { needsReply: false, confidence: 0.99 }, 0.90)).toBe(false);
  });
});
