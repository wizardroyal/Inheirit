// Signal adapters (CLAUDE.md §7.1). Each returns only the time of the owner's latest activity
// for one source — never content. Simulated adapters are flagged and read what the demo panel
// wrote (POST /demo/signal); they are labelled SIMULATED everywhere they surface.
import type { SignalSource } from "../liveness/score";
import type { OwnerSignalConfig, Store } from "../state/store";

export type Fetch = typeof fetch;

export interface SignalAdapter {
  source: SignalSource;
  simulated: boolean;
  /** 0..1: how hard the signal is to fake. */
  trustWeight: number;
  /** Most recent activity time for this owner, or null if unknown. Never returns content. */
  lastActivity(owner: OwnerSignalConfig): Promise<Date | null>;
}

/** Any NEAR transaction signed with the owner's keys (FastNEAR tx API, no key needed). */
export class NearOnchainAdapter implements SignalAdapter {
  source = "near_onchain" as const;
  simulated = false;
  trustWeight = 0.9;
  constructor(
    private readonly apiBase: string,
    private readonly fetchImpl: Fetch = fetch,
    /** Extra accounts ending in .near are read from mainnet (read-only). */
    private readonly mainnetBase = "https://tx.main.fastnear.com",
  ) {}

  /** The owner's account plus any extra accounts they added; the latest transaction across them counts. */
  async lastActivity(owner: OwnerSignalConfig): Promise<Date | null> {
    const accounts = [owner.owner, ...(owner.nearAccounts ?? [])];
    const results = await Promise.allSettled(accounts.map((a) => this.latest(a)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Date | null> => r.status === "fulfilled");
    if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
    const times = ok.map((r) => r.value?.getTime() ?? 0).filter((t) => t > 0);
    return times.length ? new Date(Math.max(...times)) : null;
  }

  private async latest(account: string): Promise<Date | null> {
    const base = account.endsWith(".near") ? this.mainnetBase : this.apiBase;
    const res = await this.fetchImpl(`${base}/v0/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: account, max_block_height: null }),
    });
    if (!res.ok) throw new Error(`FastNEAR tx API ${res.status}`);
    const body = (await res.json()) as { account_txs?: { is_any_signer?: boolean; tx_block_timestamp: string }[] };
    let latestNs = 0n;
    for (const tx of body.account_txs ?? []) {
      if (!tx.is_any_signer) continue;
      const ns = BigInt(tx.tx_block_timestamp);
      if (ns > latestNs) latestNs = ns;
    }
    return latestNs ? new Date(Number(latestNs / 1_000_000n)) : null;
  }
}

/**
 * Outgoing txs from the owner's personal Sepolia address, detected by its nonce going up between
 * polls (plain JSON-RPC, no explorer key). Accurate to one poll interval; the first poll only
 * records the nonce, since the time of earlier txs is unknown.
 */
export class EvmNonceAdapter implements SignalAdapter {
  source = "evm_onchain" as const;
  simulated = false;
  trustWeight = 0.9;
  constructor(
    private readonly rpcUrl: string,
    private readonly store: Store,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every Sepolia address the owner gave; the latest outgoing transaction across them counts. */
  async lastActivity(owner: OwnerSignalConfig): Promise<Date | null> {
    const extra = (owner.evmAddresses ?? []).filter((a) => a.toLowerCase() !== owner.evmAddress?.toLowerCase());
    const addrs: [string, string][] = [
      ...(owner.evmAddress ? ([[owner.owner, owner.evmAddress]] as [string, string][]) : []),
      // Extra addresses keep their own nonce record, keyed by owner and address.
      ...extra.map((a) => [`${owner.owner}|${a.toLowerCase()}`, a] as [string, string]),
    ];
    if (!addrs.length) return null;
    const results = await Promise.allSettled(addrs.map(([key, addr]) => this.latest(key, addr)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Date | null> => r.status === "fulfilled");
    if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
    const times = ok.map((r) => r.value?.getTime() ?? 0).filter((t) => t > 0);
    return times.length ? new Date(Math.max(...times)) : null;
  }

  private async latest(key: string, address: string): Promise<Date | null> {
    const res = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [address, "latest"] }),
    });
    if (!res.ok) throw new Error(`Sepolia RPC ${res.status}`);
    const body = (await res.json()) as { result?: string; error?: { message: string } };
    if (!body.result) throw new Error(`Sepolia RPC: ${body.error?.message ?? "no result"}`);
    const nonce = Number(BigInt(body.result));
    const prev = this.store.get().evmNonces[key];
    if (!prev) {
      this.store.update((s) => (s.evmNonces[key] = { nonce, seenAt: "" }));
      return null;
    }
    if (nonce > prev.nonce) {
      const seenAt = this.now().toISOString();
      this.store.update((s) => (s.evmNonces[key] = { nonce, seenAt }));
      return new Date(seenAt);
    }
    return prev.seenAt ? new Date(prev.seenAt) : null;
  }
}

/** Latest public GitHub event (push, comment, …). Weak: can be automated. */
export class GithubAdapter implements SignalAdapter {
  source = "github" as const;
  simulated = false;
  trustWeight = 0.5;
  constructor(private readonly token: string | undefined, private readonly fetchImpl: Fetch = fetch) {}

  async lastActivity(owner: OwnerSignalConfig): Promise<Date | null> {
    if (!owner.github) return null;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "inheirit-agent" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`https://api.github.com/users/${encodeURIComponent(owner.github)}/events/public?per_page=1`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const events = (await res.json()) as { created_at?: string }[];
    return events[0]?.created_at ? new Date(events[0].created_at) : null;
  }
}

/** Owner-signed pings from the heartbeat app (POST /api/heartbeat checks the NEP-413 signature). */
export class HeartbeatAdapter implements SignalAdapter {
  source = "phone_heartbeat" as const;
  simulated = false;
  trustWeight = 0.95;
  constructor(private readonly store: Store) {}

  async lastActivity(owner: OwnerSignalConfig): Promise<Date | null> {
    const at = this.store.get().heartbeats[owner.owner];
    return at ? new Date(at) : null;
  }
}

/**
 * Replies to the Telegram check from a chat linked to the owner (CLAUDE.md §7.7). Medium weight
 * (0.7, counts alone): the chat was bound through an owner-signed link, but a phone can be in
 * someone else's hands.
 */
export class TelegramAdapter implements SignalAdapter {
  source = "telegram" as const;
  simulated = false;
  trustWeight = 0.7;
  constructor(private readonly store: Store) {}

  async lastActivity(owner: OwnerSignalConfig): Promise<Date | null> {
    const at = this.store.get().telegramReplies[owner.owner];
    return at ? new Date(at) : null;
  }
}

/** SIMULATED source: returns what the demo panel recorded for it. */
export class SimulatedAdapter implements SignalAdapter {
  simulated = true;
  constructor(
    public readonly source: SignalSource,
    public readonly trustWeight: number,
    private readonly store: Store,
  ) {}

  async lastActivity(owner: OwnerSignalConfig): Promise<Date | null> {
    const at = this.store.get().simulated[owner.owner]?.[this.source];
    return at ? new Date(at) : null;
  }
}

export const SIMULATED_SOURCES: { source: SignalSource; trustWeight: number }[] = [
  { source: "x", trustWeight: 0.4 },
  { source: "instagram", trustWeight: 0.4 },
  { source: "tiktok", trustWeight: 0.4 },
  { source: "facebook", trustWeight: 0.4 },
  { source: "linkedin", trustWeight: 0.4 },
  { source: "google_calendar", trustWeight: 0.7 },
  { source: "gmail", trustWeight: 0.7 },
];
