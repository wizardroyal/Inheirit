// Small JSON-file store for agent state that is not on-chain: which owners to watch and their
// public signal identities, approved policies, simulated signals, execution snapshots, and the
// notification log. On Phala it lives on the CVM's encrypted disk.
import fs from "node:fs";
import path from "node:path";
import type { Policy } from "../policy/policy";
import type { SignalSource } from "../liveness/score";

export interface OwnerSignalConfig {
  owner: string;
  /** Owner's personal Sepolia address (not the vault). */
  evmAddress?: string;
  github?: string;
  /** Where to email the owner (optional; without Resend configured, notices go to the UI log). */
  email?: string;
  /** When the agent started watching (ISO). In demo mode, wills stop being driven after a while. */
  watchedSince?: string;
}

/**
 * One record per event (CLAUDE.md §7.3), listing everyone it was for and every channel it went
 * through. "ui" is always included: the web app's notification log.
 */
export interface Notification {
  at: string;
  owner: string;
  /** The will state entered, or "check" for one outreach attempt while Quiet. */
  event: string;
  /** Recipients: NEAR accounts or email addresses. */
  to: string[];
  /** e.g. ["ui", "telegram"]; "dm (SIMULATED)" for simulated DMs. Email has no sender yet. */
  channels: string[];
  subject: string;
  body: string;
}

export interface PendingTx {
  /** Serialized signed tx (EVM hex / BTC hex). */
  raw: string;
  hash: string;
  /** What this tx pays: heir id -> [address, amount in smallest units]. */
  pays: Record<string, [string, string]>;
}

export interface AgentState {
  owners: Record<string, OwnerSignalConfig>;
  policies: Record<string, Policy>;
  /** Owner-signed heartbeat pings (web /heartbeat): owner -> ISO time received. */
  heartbeats: Record<string, string>;
  /** Latest activity per source as last polled, for the UI timeline (timestamps only). */
  observations: Record<string, Partial<Record<SignalSource, { at: string; trustWeight: number; simulated: boolean }>>>;
  /** SIMULATED signals written by the demo panel: owner -> source -> ISO time. */
  simulated: Record<string, Partial<Record<SignalSource, string>>>;
  /** EVM nonce tracking for the evm_onchain adapter: owner -> { nonce, seenAt }. */
  evmNonces: Record<string, { nonce: number; seenAt: string }>;
  /** Foreign vault balances at execution start: `${owner}:${round}:${chain}` -> smallest units. */
  snapshots: Record<string, string>;
  /**
   * Signed foreign txs saved before broadcast, so a crash or RPC failure rebroadcasts the same tx
   * instead of signing a second one: `${owner}:${round}:${stage}:${chain}` -> pending tx.
   */
  pendingTxs: Record<string, PendingTx>;
  /** Last will state the driver notified about: owner -> state name. */
  notifiedState: Record<string, string>;
  notifications: Notification[];
  /** Pending Telegram deep-link tokens: token -> account (one-time, short-lived). */
  telegramLinks: Record<string, { account: string; expiresAt: string }>;
  /** Linked Telegram chats: account -> chat. */
  telegramChats: Record<string, { chatId: number; linkedAt: string }>;
  /** Latest reply from a linked chat: account -> ISO receive time. Never the text. */
  telegramReplies: Record<string, string>;
  /** getUpdates offset (last handled update_id + 1). */
  telegramOffset: number;
  /** Quiet-state checks already sent: owner -> { quiet since (s), channels done }. */
  checks: Record<string, { since: number; done: string[] }>;
  /**
   * Telegram messages already sent during the owner's current silence: owner -> { last_alive_at (s),
   * events }. An expired guardian vote restarts the ladder with the same last_alive_at; the repeat
   * check and welfare messages are not sent to phones again (§7.3 known noise).
   */
  telegramSent: Record<string, { lastAliveAt: number; events: string[] }>;
  /** Demo faucet top-ups already sent: owner -> sends (one funding per will). */
  faucetSends: Record<string, { chain: "Eth" | "Btc"; to: string; amount: string; txHash: string }[]>;
}

const EMPTY: AgentState = {
  owners: {},
  policies: {},
  heartbeats: {},
  observations: {},
  simulated: {},
  evmNonces: {},
  snapshots: {},
  pendingTxs: {},
  notifiedState: {},
  notifications: [],
  telegramLinks: {},
  telegramChats: {},
  telegramReplies: {},
  telegramOffset: 0,
  checks: {},
  telegramSent: {},
  faucetSends: {},
};

export class Store {
  private state: AgentState;
  constructor(private readonly file: string | null) {
    this.state = structuredClone(EMPTY);
    if (file && fs.existsSync(file)) {
      this.state = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(file, "utf8")) };
    }
  }

  static inDir(dir: string): Store {
    fs.mkdirSync(dir, { recursive: true });
    return new Store(path.join(dir, "agent-state.json"));
  }

  get(): Readonly<AgentState> {
    return this.state;
  }

  update(fn: (s: AgentState) => void): void {
    fn(this.state);
    if (this.file) {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, this.file);
    }
  }
}
