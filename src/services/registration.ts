import { createHmac, timingSafeEqual } from 'node:crypto';

function signature(staffId: string, username: string, expiry: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`staff-invite:${staffId}:${username.toLowerCase()}:${expiry}`)
    .digest('base64url').slice(0, 22);
}

// At most 63 characters, within Telegram's 64-character start parameter limit.
export function createRegistrationInvite(staffId: string, username: string, secret: string, now = Date.now()): string {
  const id = staffId.replaceAll('-', '');
  const expiry = Math.floor((now + 24 * 3600_000) / 1000).toString(36);
  return `${id}.${expiry}.${signature(id, username, expiry, secret)}`;
}

export function validRegistrationInvite(token: string, staffId: string, username: string, secret: string, now = Date.now()): boolean {
  const match = /^([a-f0-9]{32})\.([a-z0-9]{6,7})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!match || match[1] !== staffId.replaceAll('-', '')) return false;
  const expires = parseInt(match[2], 36) * 1000;
  if (!Number.isFinite(expires) || expires <= now || expires > now + 24 * 3600_000) return false;
  return timingSafeEqual(Buffer.from(match[3]), Buffer.from(signature(match[1], username, match[2], secret)));
}
