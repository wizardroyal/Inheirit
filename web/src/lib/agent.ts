"use client";
// Client for the will agent's HTTP API (src/api.ts in the repo root).
import { boostPolling, shared } from "./boost";
import type { AttestationResult } from "@agent/ai/attestation";
import type { GuideAnswer } from "@agent/ai/heir-guide";
import type { PolicyDraft } from "@agent/ai/policy-parser";
import type { Policy } from "@agent/policy/policy";
import { AGENT_URL } from "./config";
import type { SignedRequest } from "./near";

async function req<T>(path: string, body?: unknown): Promise<T> {
  // Reads are shared between components for a moment; a successful write speeds polling up briefly.
  if (body === undefined) return shared(`agent:${path}`, () => send<T>(path));
  const out = await send<T>(path, body);
  boostPolling();
  return out;
}

async function send<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {
    throw new Error("The will agent isn't answering right now (it may be restarting or switched off). Try again in a minute.");
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: unknown; errors?: string[] }).errors?.join("; ") ?? (json as { error?: unknown }).error;
    throw new Error(typeof err === "string" ? err : `${path}: ${res.status} ${JSON.stringify(err ?? json)}`);
  }
  return json as T;
}

export interface AgentInfo {
  accountId: string;
  balance: number;
  agentContractId: string;
  sealedNotes: { x25519_pubkey: string; app_id: string; tee: boolean; enabled: boolean };
}

/** One record per event, with everyone it was for and every channel it went through (agent §7.3). */
export interface Notification {
  at: string;
  owner: string;
  /** The will state entered, or "check" for one outreach attempt while Quiet. */
  event: string;
  to: string[];
  channels: string[];
  subject: string;
  body: string;
}

export type SignalSource =
  | "near_onchain"
  | "evm_onchain"
  | "phone_heartbeat"
  | "github"
  | "telegram"
  | "google_calendar"
  | "gmail"
  | "x"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "whatsapp"
  | "linkedin";
export type Observations = Partial<Record<SignalSource, { at: string; trustWeight: number; simulated: boolean }>>;
/** Per foreign vault: address and balance, or an error (with the derived address as `vault` when only the balance lookup failed). */
export type VaultInfo = Record<"Eth" | "Btc", { address: string; balance: string } | { error: string; vault?: string }>;

export type DraftResult = PolicyDraft;

/** Plain-English liveness verdict from the agent (deterministic, no LLM). */
export interface Verdict {
  headline: string;
  details: string[];
  ignored: { source: SignalSource; reason: string }[];
}

export type Signals = { observations: Observations; heartbeat: string | null; verdict: Verdict | null };
export type Status = { state: string; watching: unknown; has_policy: boolean; simulated_signals: Record<string, string> };
export type TelegramStatus = { enabled: boolean; bot?: string; linked: boolean };
export interface Overview {
  status: Status | null;
  signals: Signals;
  notifications: Notification[];
  telegram: TelegramStatus;
  /** The owner's chosen display name (older agents omit it). */
  display_name?: string | null;
}

/** NEAR Intents (agent §J). The agent's 1Click client is SIMULATED: NEAR Intents has no testnet. */
export interface IntentsToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
}
export type PayoutBatch = import("@agent/state/store").PayoutBatch;
export type PayoutPref = import("@agent/state/store").PayoutPref;
export interface HeirPayouts {
  pref: PayoutPref | null;
  batches: PayoutBatch[];
  waiting: { key: string; chain: string; symbol: string; amount: string; usd: number | null; exhausted: boolean }[];
}
export interface Payouts {
  enabled: boolean;
  simulated: boolean;
  started: boolean;
  value_mode: "as_is" | "stable";
  min_usd: number;
  heirs: Record<string, HeirPayouts>;
}
export interface FundQuote {
  simulated: boolean;
  vault: string;
  recipient: string;
  origin: { symbol: string; blockchain: string };
  quote: { depositAddress?: string; amountInFormatted: string; amountInUsd: string; amountOutFormatted: string; amountOutUsd: string; deadline?: string; timeEstimate: number };
}

export const agent = {
  /** One request for everything the owner/demo panels show. Falls back to the separate routes for agents without it. */
  overview: async (owner: string): Promise<Overview> => {
    const o = encodeURIComponent(owner);
    try {
      return await req<Overview>(`/api/overview/${o}`);
    } catch (e) {
      if (!/: 404\b/.test(String(e))) throw e;
      const [signals, status, notifications, telegram] = await Promise.all([
        req<Signals>(`/api/signals/${o}`),
        req<Status>(`/api/status/${o}`).catch(() => null),
        req<Notification[]>(`/api/notifications?owner=${o}`),
        req<TelegramStatus>(`/api/telegram/${o}`).catch(() => ({ enabled: false, linked: false })),
      ]);
      return { signals, status, notifications: notifications.slice(-30), telegram };
    }
  },
  root: () => req<{ message: string; demoMode: boolean }>("/"),
  info: () => req<AgentInfo>("/api/agent-info"),
  aiAttestation: () => req<AttestationResult>("/api/attestation/ai"),
  notifications: (owner: string) => req<Notification[]>(`/api/notifications?owner=${encodeURIComponent(owner)}`),
  signals: (owner: string) => req<{ observations: Observations; heartbeat: string | null; verdict: Verdict | null }>(`/api/signals/${encodeURIComponent(owner)}`),
  vaults: (owner: string) => req<VaultInfo>(`/api/vaults/${encodeURIComponent(owner)}`),
  status: (owner: string) => req<{ state: string; watching: unknown; has_policy: boolean; simulated_signals: Record<string, string> }>(`/api/status/${encodeURIComponent(owner)}`),
  registerOwner: (signed: SignedRequest) => req<{ ok: true; watching: unknown }>("/api/owners", { signed }),
  heartbeat: (signed: SignedRequest) => req<{ ok: true; at: string }>("/api/heartbeat", { signed }),
  draftPolicy: (signed: SignedRequest) => req<DraftResult>("/api/policy/draft", { signed }),
  heirGuide: (signed: SignedRequest) => req<GuideAnswer>("/api/heir/guide", { signed }),
  submitPolicy: (owner: string, policy: Policy) => req<{ ok: true; policy_hash: string }>("/api/policy", { owner, policy }),
  faucetInfo: () => req<{ enabled: false } | { enabled: true; eth: string; btc: string; eth_wei: string; btc_sats: number }>("/demo/faucet"),
  /** Demo vault faucet (demo mode only): funds the will's empty Sepolia/BTC vaults once. */
  faucet: (signed: SignedRequest) => req<{ ok: boolean; sends: { chain: string; to: string; amount: string; txHash: string }[]; errors: string[] }>("/demo/faucet", { signed }),
  telegramStatus: (account: string) => req<{ enabled: boolean; bot?: string; linked: boolean }>(`/api/telegram/${encodeURIComponent(account)}`),
  /** One-time t.me link that binds a Telegram chat to the signing account. */
  telegramLink: (signed: SignedRequest) => req<{ ok: true; url: string; expires_at: string }>("/api/telegram/link", { signed }),
  intentsTokens: () => req<{ enabled: boolean; simulated?: boolean; tokens: IntentsToken[] }>("/api/intents/tokens"),
  payouts: (owner: string, heir?: string) => req<Payouts>(`/api/payouts/${encodeURIComponent(owner)}${heir ? `?heir=${encodeURIComponent(heir)}` : ""}`),
  /** The heir's own payout choice, signed by the heir. */
  setPayout: (signed: SignedRequest) => req<{ ok: true; simulated: boolean; pref: PayoutPref }>("/api/heir/payout", { signed }),
  fundQuote: (owner: string, vault: "Near" | "Eth" | "Btc", origin_asset: string, amount: string) => req<FundQuote>("/api/intents/fund-quote", { owner, vault, origin_asset, amount }),
  fundSent: (deposit_address: string) => req<{ ok: true }>("/api/intents/fund-sent", { deposit_address }),
  intentsStatus: (depositAddress: string) => send<{ simulated: boolean; status: string }>(`/api/intents/status?depositAddress=${encodeURIComponent(depositAddress)}`),
  /** SIMULATED signal (demo mode only). */
  /** Signed by the owner (an unsigned route would let anyone keep any demo will alive). */
  simulate: (signed: SignedRequest) => req<{ ok: true }>("/demo/signal", { signed }),
};
