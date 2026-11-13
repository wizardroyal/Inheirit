// Liveness scoring (CLAUDE.md §7.2). Plain rules, no AI:
// - a strong signal (trustWeight >= 0.7: signed on-chain txs, phone heartbeat) counts on its own;
// - weaker signals (social posts can be scheduled or run by someone else) count only when at least
//   two different weak sources agree within a window, and then only from the older of them.
// Adapters return timestamps only; nothing here ever sees content.

export type SignalSource =
  | "near_onchain"
  | "evm_onchain"
  | "phone_heartbeat"
  | "github"
  | "google_calendar"
  | "gmail"
  | "telegram"
  | "x"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "linkedin";

export interface Observation {
  source: SignalSource;
  /** Most recent activity seen for this source. */
  at: Date;
  trustWeight: number;
  simulated: boolean;
}

export interface ScoreOptions {
  strongWeight: number;
  /** How close in time two weak sources must be to corroborate each other. */
  weakWindowMs: number;
  /** Timestamps further in the future than this are ignored (clock skew / bad data). */
  maxFutureSkewMs: number;
}

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = {
  strongWeight: 0.7,
  weakWindowMs: 24 * 60 * 60 * 1000,
  maxFutureSkewMs: 60 * 1000,
};

export interface AliveVerdict {
  at: Date;
  /** Sources that justify the verdict. */
  basis: SignalSource[];
}

/** The latest time the owner can be considered alive, or null if no rule is satisfied. */
export function scoreAlive(
  observations: Observation[],
  now: Date,
  opts: ScoreOptions = DEFAULT_SCORE_OPTIONS,
): AliveVerdict | null {
  const usable = observations.filter((o) => o.at.getTime() <= now.getTime() + opts.maxFutureSkewMs);
  let best: AliveVerdict | null = null;
  const consider = (at: Date, basis: SignalSource[]) => {
    const clamped = at.getTime() > now.getTime() ? now : at;
    if (!best || clamped.getTime() > best.at.getTime()) best = { at: clamped, basis };
  };

  for (const o of usable) {
    if (o.trustWeight >= opts.strongWeight) consider(o.at, [o.source]);
  }

  const weak = usable.filter((o) => o.trustWeight < opts.strongWeight);
  for (let i = 0; i < weak.length; i++) {
    for (let j = i + 1; j < weak.length; j++) {
      const a = weak[i];
      const b = weak[j];
      if (a.source === b.source) continue;
      if (Math.abs(a.at.getTime() - b.at.getTime()) <= opts.weakWindowMs) {
        consider(a.at < b.at ? a.at : b.at, [a.source, b.source]);
      }
    }
  }
  return best;
}

/**
 * Before checks start (the will is at All good): an on-chain silence is first compared with the weak
 * sources, because someone can stop transacting for their own reasons while still being active. A lone
 * weak signal newer than the last strong one postpones the checks, but by at most one quiet period after
 * that strong signal, so scheduled posts can never hold a will off for ever. Once checks have started,
 * only the rules in `scoreAlive` count (human decision 2026-11-13).
 */
export function scoreBeforeChecks(
  observations: Observation[],
  now: Date,
  quietAfterS: number,
  opts: ScoreOptions = DEFAULT_SCORE_OPTIONS,
): AliveVerdict | null {
  const base = scoreAlive(observations, now, opts);
  if (!base) return null;
  const limit = base.at.getTime() + quietAfterS * 1000;
  let best: AliveVerdict = base;
  for (const o of observations) {
    if (o.trustWeight >= opts.strongWeight) continue;
    const t = Math.min(o.at.getTime(), now.getTime());
    if (o.at.getTime() > now.getTime() + opts.maxFutureSkewMs) continue;
    if (t > best.at.getTime() && t <= limit) best = { at: new Date(t), basis: [o.source] };
  }
  return best;
}
