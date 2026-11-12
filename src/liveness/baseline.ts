// "Longer than usual", measured (CLAUDE.md §7.2): the owner's typical gap between strong signals, from
// their own transaction history. Plain statistics, no AI. Shared by the web app (suggests the quiet
// period at setup) and the agent (says "usually every N days" in the verdict). Timestamps only.

const DAY = 86_400;
/** Transactions closer together than this are one session (a burst of clicks is one sign of life). */
const SESSION_GAP_S = 3_600;
/** Fewer sessions than this in the window: not enough history to say what's usual. */
export const MIN_SESSIONS = 5;
export const WINDOW_DAYS = 90;
/** Suggested quiet period: this many typical gaps, between the bounds below. */
export const SUGGEST_FACTOR = 3;
export const MIN_QUIET_S = 30 * DAY;
export const MAX_QUIET_S = 180 * DAY;
/** With too little history, the default real-timing quiet period. */
export const DEFAULT_QUIET_S = 30 * DAY;

export interface Baseline {
  /** Median gap between sessions, in seconds; null when there isn't enough history. */
  medianGapS: number | null;
  /** Sessions in the window (bursts collapsed). */
  sessions: number;
  /** Suggested quiet period in seconds (whole days). */
  suggestedQuietS: number;
  /** Where the timestamps came from, e.g. ["NEAR", "Sepolia"]. */
  sources: string[];
}

/** Median of a non-empty list. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The baseline from activity times (unix seconds, any order, any source mix): collapse bursts into
 * sessions, take the median gap between sessions in the last WINDOW_DAYS, and suggest
 * SUGGEST_FACTOR × that gap, rounded up to whole days and clamped to [MIN_QUIET_S, MAX_QUIET_S].
 */
export function computeBaseline(times: number[], nowS: number, sources: string[] = []): Baseline {
  const from = nowS - WINDOW_DAYS * DAY;
  const sorted = [...new Set(times.filter((t) => Number.isFinite(t) && t >= from && t <= nowS + 300))].sort((a, b) => a - b);
  const sessions: number[] = [];
  for (const t of sorted) if (!sessions.length || t - sessions[sessions.length - 1] > SESSION_GAP_S) sessions.push(t);
  if (sessions.length < MIN_SESSIONS) return { medianGapS: null, sessions: sessions.length, suggestedQuietS: DEFAULT_QUIET_S, sources };
  const gaps = sessions.slice(1).map((t, i) => t - sessions[i]);
  const medianGapS = Math.round(median(gaps));
  const raw = Math.ceil((SUGGEST_FACTOR * medianGapS) / DAY) * DAY;
  return { medianGapS, sessions: sessions.length, suggestedQuietS: Math.min(MAX_QUIET_S, Math.max(MIN_QUIET_S, raw)), sources };
}

/** "every 3 days", "every 5 hours", "several times a day". */
export function everyPhrase(gapS: number): string {
  if (gapS < 3 * 3600) return "several times a day";
  if (gapS < 1.5 * DAY) return `every ${Math.round(gapS / 3600)} hours`;
  return `every ${Math.round(gapS / DAY)} days`;
}

type Fetch = typeof fetch;

/** FastNEAR's tx API for an account: mainnet for *.near, testnet otherwise. Times of txs it signed. */
export async function nearActivityTimes(account: string, fetchImpl: Fetch = fetch, base?: string): Promise<number[]> {
  const api = base ?? (account.endsWith(".near") ? "https://tx.main.fastnear.com" : "https://tx.test.fastnear.com");
  const res = await fetchImpl(`${api}/v0/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: account, max_block_height: null }),
  });
  if (!res.ok) throw new Error(`FastNEAR tx API ${res.status}`);
  const body = (await res.json()) as { account_txs?: { is_any_signer?: boolean; tx_block_timestamp: string }[] };
  return (body.account_txs ?? []).filter((t) => t.is_any_signer).map((t) => Number(BigInt(t.tx_block_timestamp) / 1_000_000_000n));
}

/** Blockscout (no key needed): times of transactions sent from a Sepolia address. */
export async function sepoliaActivityTimes(address: string, fetchImpl: Fetch = fetch): Promise<number[]> {
  const res = await fetchImpl(`https://eth-sepolia.blockscout.com/api/v2/addresses/${address}/transactions?filter=from`);
  if (!res.ok) throw new Error(`Blockscout ${res.status}`);
  const body = (await res.json()) as { items?: { timestamp: string }[] };
  return (body.items ?? []).map((t) => Math.floor(Date.parse(t.timestamp) / 1000)).filter(Number.isFinite);
}

/** The baseline across the owner's NEAR accounts and Sepolia addresses; a source that fails is skipped. */
export async function fetchBaseline(near: string[], sepolia: string[], nowS = Math.floor(Date.now() / 1000), fetchImpl: Fetch = fetch): Promise<Baseline> {
  const times: number[] = [];
  const sources = new Set<string>();
  await Promise.all([
    ...near.map((a) =>
      nearActivityTimes(a, fetchImpl)
        .then((t) => (times.push(...t), t.length && sources.add("NEAR")))
        .catch(() => {}),
    ),
    ...sepolia.map((a) =>
      sepoliaActivityTimes(a, fetchImpl)
        .then((t) => (times.push(...t), t.length && sources.add("Sepolia")))
        .catch(() => {}),
    ),
  ]);
  return computeBaseline(times, nowS, [...sources]);
}
