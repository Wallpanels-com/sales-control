import { describe, expect, it } from 'vitest';
import { createRegistrationInvite, validRegistrationInvite } from './registration.js';

const id = '12345678-1234-1234-1234-123456789abc';
const now = Date.parse('2026-10-18T20:00:00Z');
describe('registration invitations', () => {
  it('binds a short signed invitation to one approved staff username', () => {
    const token = createRegistrationInvite(id, 'Kit', 'secret', now);
    expect(token.length).toBeLessThanOrEqual(64);
    expect(validRegistrationInvite(token, id, 'kit', 'secret', now)).toBe(true);
    expect(validRegistrationInvite(token, id, 'other', 'secret', now)).toBe(false);
    expect(validRegistrationInvite(token, id, 'kit', 'wrong-secret', now)).toBe(false);
    expect(validRegistrationInvite(token, id, 'kit', 'secret', now + 24 * 3600_000)).toBe(false);
  });
  it('rejects tampered and malformed invitations', () => {
    const token = createRegistrationInvite(id, 'Kit', 'secret', now);
    expect(validRegistrationInvite(`${token.slice(0, -1)}!`, id, 'Kit', 'secret', now)).toBe(false);
    expect(validRegistrationInvite(token, '00000000-1234-1234-1234-123456789abc', 'Kit', 'secret', now)).toBe(false);
  });
});
