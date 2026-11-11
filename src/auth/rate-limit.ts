// Fixed-window limits for routes that spend money (NEAR AI credit, demo faucet coins). Free testnet
// accounts can sign requests, so a signature alone doesn't stop abuse: each key gets a quota, and a
// global quota caps the total. In memory: a restart resets the windows, which is acceptable here.

export interface Limit {
  /** Allowed per key in each window. */
  perKey: number;
  /** Allowed across all keys in each window. */
  global: number;
  windowMs: number;
}

export class RateLimiter {
  private windowStart = 0;
  private total = 0;
  private readonly counts = new Map<string, number>();
  constructor(
    private readonly limit: Limit,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one use for `key`; returns how long to wait (ms) if over a limit, else 0. */
  take(key: string): number {
    const t = this.now();
    if (t - this.windowStart >= this.limit.windowMs) {
      this.windowStart = t;
      this.total = 0;
      this.counts.clear();
    }
    const used = this.counts.get(key) ?? 0;
    if (used >= this.limit.perKey || this.total >= this.limit.global) return this.windowStart + this.limit.windowMs - t;
    this.counts.set(key, used + 1);
    this.total++;
    return 0;
  }

  /** Gives back one use taken for `key` (the action it paid for didn't happen). */
  refund(key: string): void {
    const used = this.counts.get(key) ?? 0;
    if (used > 0) {
      this.counts.set(key, used - 1);
      this.total = Math.max(0, this.total - 1);
    }
  }
}

const HOUR = 60 * 60_000;
export const AI_DRAFT_LIMIT: Limit = { perKey: 6, global: 120, windowMs: HOUR };
export const AI_GUIDE_LIMIT: Limit = { perKey: 20, global: 300, windowMs: HOUR };
// Per owner: a few attempts so a chain whose send failed can be retried; each chain is still funded once.
/** Fund-from-anywhere quotes are unsigned (a preview), so they are bounded per owner and in total. */
export const FUND_QUOTE_LIMIT: Limit = { perKey: 30, global: 600, windowMs: HOUR };
/** Signed signs of life (heartbeat, SIMULATED demo signals): plenty for a person, not for a script. */
export const SIGNAL_LIMIT: Limit = { perKey: 120, global: 20_000, windowMs: HOUR };
export const FAUCET_LIMIT: Limit = { perKey: 3, global: 30, windowMs: 24 * HOUR };
