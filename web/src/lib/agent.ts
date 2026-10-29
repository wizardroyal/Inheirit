"use client";
// Client for the will agent's HTTP API (src/api.ts in the repo root).
import type { AttestationResult } from "@agent/ai/attestation";
import type { GuideAnswer } from "@agent/ai/heir-guide";
import type { PolicyDraft } from "@agent/ai/policy-parser";
import type { Policy } from "@agent/policy/policy";
import { AGENT_URL } from "./config";
import type { SignedRequest } from "./near";

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

export interface Notification {
  at: string;
  owner: string;
  to: string;
  channel: "ui" | "email";
  subject: string;
  body: string;
}

export type SignalSource = "near_onchain" | "evm_onchain" | "phone_heartbeat" | "github" | "google_calendar" | "gmail" | "x" | "instagram";
export type Observations = Partial<Record<SignalSource, { at: string; trustWeight: number; simulated: boolean }>>;
export type VaultInfo = Record<"Eth" | "Btc", { address: string; balance: string } | { error: string }>;

export type DraftResult = PolicyDraft;

export const agent = {
  root: () => req<{ message: string; demoMode: boolean }>("/"),
  info: () => req<AgentInfo>("/api/agent-info"),
  aiAttestation: () => req<AttestationResult>("/api/attestation/ai"),
  notifications: (owner: string) => req<Notification[]>(`/api/notifications?owner=${encodeURIComponent(owner)}`),
  signals: (owner: string) => req<{ observations: Observations; heartbeat: string | null }>(`/api/signals/${encodeURIComponent(owner)}`),
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
  /** SIMULATED signal (demo mode only). */
  simulate: (owner: string, source: SignalSource) => req<{ ok: true }>("/demo/signal", { owner, source }),
};
