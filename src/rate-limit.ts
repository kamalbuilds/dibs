// In-memory sliding-window limiter for the public claim route. One process per Fly machine, so memory is enough;
// limits reset on restart, which is acceptable for an abuse guard (the claim queue itself is in SQLite).

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: () => number, private readonly windowMs: () => number) {}

  check(key: string, now = Date.now()): LimitResult {
    const limit = this.limit();
    if (!(limit > 0)) return { ok: true };
    const windowMs = this.windowMs();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(now, windowMs);
    return { ok: true };
  }

  reset(): void { this.hits.clear(); }

  private sweep(now: number, windowMs: number): void {
    for (const [key, times] of this.hits) if (!times.some((at) => at > now - windowMs)) this.hits.delete(key);
  }
}

const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
};

// Defaults: 30 claim requests a minute per client IP, 10 a minute per handle per sale. Set a limit to 0 to turn it off.
export const claimWindowMs = () => envNumber("CLAIM_RATE_WINDOW_MS", 60_000);
export const claimLimitPerIp = new SlidingWindowLimiter(() => envNumber("CLAIM_RATE_PER_IP", 30), claimWindowMs);
export const claimLimitPerHandle = new SlidingWindowLimiter(() => envNumber("CLAIM_RATE_PER_HANDLE", 10), claimWindowMs);
