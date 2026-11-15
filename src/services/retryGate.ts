// Process-local, bounded by current incidents. New inbound IDs get a fresh
// attempt; unavailable historical conversations do not generate minute loops.
export class RetryGate {
  private readonly failures = new Map<string, { attempts: number; retryAt: number }>();

  allows(key: string, now = Date.now()): boolean {
    return now >= (this.failures.get(key)?.retryAt || 0);
  }

  defer(key: string, now = Date.now()): number {
    const attempts = (this.failures.get(key)?.attempts || 0) + 1;
    const delay = Math.min(15 * 60_000 * 2 ** Math.min(attempts - 1, 2), 60 * 60_000);
    const retryAt = now + delay;
    this.failures.set(key, { attempts, retryAt });
    return retryAt;
  }

  clear(key: string): void { this.failures.delete(key); }

  retain(keys: Set<string>): void {
    for (const key of this.failures.keys()) if (!keys.has(key)) this.failures.delete(key);
  }
}
