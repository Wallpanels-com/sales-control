import { describe, expect, it } from 'vitest';
import { RetryGate } from './retryGate.js';

describe('conversation verification backoff', () => {
  it('does not retry an unavailable conversation every minute', () => {
    const gate = new RetryGate();
    let now = 1_000;
    for (const delay of [15, 30, 60, 60]) {
      expect(gate.allows('incident:inbound', now)).toBe(true);
      const retryAt = gate.defer('incident:inbound', now);
      expect(retryAt).toBe(now + delay * 60_000);
      expect(gate.allows('incident:inbound', now + 60_000)).toBe(false);
      now = retryAt;
    }
    expect(gate.allows('incident:new-inbound', now)).toBe(true);
  });

  it('clears failures on recovery and releases memory for closed incidents', () => {
    const gate = new RetryGate();
    gate.defer('old', 1_000);
    gate.defer('active', 1_000);
    gate.retain(new Set(['active']));
    expect(gate.allows('old', 1_000)).toBe(true);
    expect(gate.allows('active', 1_000)).toBe(false);
    gate.clear('active');
    expect(gate.allows('active', 1_000)).toBe(true);
  });
});
