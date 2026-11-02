import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireDatabasePermit,
  databaseCircuitSnapshot,
  isSupabaseQuotaError,
  observeSupabaseHttpStatus,
  releaseDatabasePermit,
  resetDatabaseCircuitForTests
} from './databaseCircuit.js';

afterEach(() => {
  resetDatabaseCircuitForTests();
  vi.restoreAllMocks();
});

describe('Supabase quota circuit breaker', () => {
  it('pauses repeated work after a 402 and allows only one probe later', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    observeSupabaseHttpStatus(402, 1_000);

    expect(databaseCircuitSnapshot(2_000).blocked).toBe(true);
    expect(acquireDatabasePermit(2_000)).toBeNull();

    const probe = acquireDatabasePermit(1_000 + 15 * 60_000);
    expect(probe).toBe('probe');
    expect(acquireDatabasePermit(1_000 + 15 * 60_000)).toBeNull();
    releaseDatabasePermit(probe!);
  });

  it('closes the circuit after the probe reaches Supabase successfully', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    observeSupabaseHttpStatus(402, 1_000);
    const probe = acquireDatabasePermit(1_000 + 15 * 60_000);
    expect(probe).toBe('probe');

    observeSupabaseHttpStatus(200, 1_000 + 15 * 60_000);
    releaseDatabasePermit(probe!);

    expect(databaseCircuitSnapshot().blocked).toBe(false);
    expect(acquireDatabasePermit()).toBe('normal');
  });

  it('recognizes the Data API payment-required error without matching unrelated failures', () => {
    expect(isSupabaseQuotaError({ status: 402, message: 'Payment Required' })).toBe(true);
    expect(isSupabaseQuotaError({ message: 'HTTP 402 from PostgREST' })).toBe(true);
    expect(isSupabaseQuotaError({ status: 500, message: 'Database unavailable' })).toBe(false);
  });
});
