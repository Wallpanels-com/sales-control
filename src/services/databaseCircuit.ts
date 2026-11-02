const BASE_RETRY_MS = 15 * 60_000;
const MAX_RETRY_MS = 60 * 60_000;

let blockedUntil = 0;
let consecutiveBlocks = 0;
let probeInFlight = false;

function retryDelay(): number {
  return Math.min(BASE_RETRY_MS * 2 ** Math.max(0, consecutiveBlocks - 1), MAX_RETRY_MS);
}

export function observeSupabaseHttpStatus(status: number, now = Date.now()): void {
  if (status === 402) {
    if (blockedUntil > now) return;
    consecutiveBlocks++;
    blockedUntil = Math.max(blockedUntil, now + retryDelay());
    console.warn('Supabase Data API quota block detected; database work paused', {
      retryAt: new Date(blockedUntil).toISOString(),
      consecutiveBlocks
    });
    return;
  }
  if (probeInFlight && status >= 200 && status < 300) {
    blockedUntil = 0;
    consecutiveBlocks = 0;
    console.info('Supabase Data API access restored');
  }
}

export function isSupabaseQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as Record<string, unknown>;
  const text = [value.code, value.message, value.details, value.hint]
    .filter(part => typeof part === 'string').join(' ').toLowerCase();
  return value.status === 402 || value.statusCode === 402
    || /(^|\D)402(\D|$)|payment required|quota/.test(text);
}

export function observeSupabaseError(error: unknown, now = Date.now()): void {
  if (isSupabaseQuotaError(error)) observeSupabaseHttpStatus(402, now);
}

export type DatabasePermit = 'normal' | 'probe';

export function acquireDatabasePermit(now = Date.now()): DatabasePermit | null {
  if (!blockedUntil) return 'normal';
  if (now < blockedUntil || probeInFlight) return null;
  probeInFlight = true;
  return 'probe';
}

export function releaseDatabasePermit(permit: DatabasePermit): void {
  if (permit === 'probe') probeInFlight = false;
}

export function databaseCircuitSnapshot(now = Date.now()) {
  return {
    blocked: blockedUntil > 0,
    retryAllowed: blockedUntil > 0 && now >= blockedUntil,
    retryAt: blockedUntil ? new Date(blockedUntil).toISOString() : null,
    consecutiveBlocks
  };
}

export function resetDatabaseCircuitForTests(): void {
  blockedUntil = 0;
  consecutiveBlocks = 0;
  probeInFlight = false;
}
