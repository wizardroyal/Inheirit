// Typed access to the will contract (agent-contract/src/will). The driver and executor depend on
// the WillContract interface so tests can use a fake.
import type { ShadeClient } from "@neardefi/shade-agent-js";

export type Chain = "Near" | "Eth" | "Btc";
export type ForeignChain = Exclude<Chain, "Near">;

export type WillState =
  | "Active"
  | { Quiet: { since: number } }
  | { WelfareCheck: { since: number } }
  | { GuardianVote: { since: number } }
  | { Challenge: { since: number } }
  | { Executing: { stage: number; since: number; stage_started: number } }
  | { Completed: { at: number } };

export type StateName = "Active" | "Quiet" | "WelfareCheck" | "GuardianVote" | "Challenge" | "Executing" | "Completed";

export function stateName(s: WillState): StateName {
  return (typeof s === "string" ? s : Object.keys(s)[0]) as StateName;
}

export interface WillView {
  owner: string;
  heirs: { account_id: string; name: string; near_share_bps: number; x25519_pubkey: string | null }[];
  guardians: string[];
  guardian_threshold: number;
  contacts: string[];
  stages_pct: number[];
  timings: Record<string, number>;
  policy_hash: string;
  foreign_chains: ForeignChain[];
  state: WillState;
  last_alive_at: number;
  execution_round: number;
  near_balance: string;
  pending_withdrawals: { id: number; chain: Chain; to: string; amount: string; signatures: number }[];
  executions: { round: number; stage: number; chain: Chain; to: string; amount: string; tx_hash: string }[];
  stage_done: { stage: number; chain: Chain }[];
  sealed_notes: { id: number; heir: string; label: string; ciphertext: string }[];
  released_notes: { note_id: number; heir: string }[];
}

export type SignPurpose = { Release: { stage: number } } | { Withdrawal: { id: number } };

/** The MPC signature as returned through the contract (chainsig.js MPCSignature shape). */
export type MpcSignature = unknown;

export interface WillContract {
  getWill(owner: string): Promise<WillView | null>;
  recordLiveness(owner: string, atSeconds: number): Promise<boolean>;
  advance(owner: string): Promise<boolean>;
  requestSignature(owner: string, chain: ForeignChain, payloadHex: string, purpose: SignPurpose): Promise<MpcSignature>;
  recordExecution(owner: string, stage: number, chain: ForeignChain, to: string, amount: string, txHash: string): Promise<void>;
  markStageDone(owner: string, stage: number, chain: ForeignChain): Promise<void>;
  completeWithdrawal(owner: string, id: number, txHash: string): Promise<void>;
  getAgentPubkey(): Promise<AgentKey | null>;
  setAgentPubkey(x25519Pubkey: string, appId: string): Promise<void>;
  storeReleasedNote(owner: string, noteId: number, heir: string, ciphertextB64: string): Promise<void>;
}

export interface AgentKey {
  x25519_pubkey: string;
  app_id: string;
}

const TGAS = 10n ** 12n;

export class ShadeWillContract implements WillContract {
  constructor(private readonly agent: ShadeClient) {}

  async getWill(owner: string) {
    // The contract returns JSON null when there is no will for this owner.
    const will = await this.agent.view<object>({ methodName: "get_will", args: { owner } });
    return (will as WillView | null) ?? null;
  }
  async recordLiveness(owner: string, atSeconds: number) {
    return this.agent.call<boolean>({ methodName: "record_liveness", args: { owner, at: atSeconds }, gas: 30n * TGAS });
  }
  async advance(owner: string) {
    return this.agent.call<boolean>({ methodName: "advance", args: { owner }, gas: 100n * TGAS });
  }
  async requestSignature(owner: string, chain: ForeignChain, payloadHex: string, purpose: SignPurpose) {
    return this.agent.call({
      methodName: "request_signature",
      args: { owner, chain, payload: payloadHex, purpose },
      gas: 300n * TGAS,
    });
  }
  async recordExecution(owner: string, stage: number, chain: ForeignChain, to: string, amount: string, txHash: string) {
    await this.agent.call({ methodName: "record_execution", args: { owner, stage, chain, to, amount, tx_hash: txHash }, gas: 30n * TGAS });
  }
  async markStageDone(owner: string, stage: number, chain: ForeignChain) {
    await this.agent.call({ methodName: "mark_stage_done", args: { owner, stage, chain }, gas: 30n * TGAS });
  }
  async completeWithdrawal(owner: string, id: number, txHash: string) {
    await this.agent.call({ methodName: "complete_withdrawal", args: { owner, id, tx_hash: txHash }, gas: 30n * TGAS });
  }
  async getAgentPubkey() {
    const key = await this.agent.view<object>({ methodName: "get_agent_pubkey", args: {} });
    return (key as AgentKey | null) ?? null;
  }
  async setAgentPubkey(x25519Pubkey: string, appId: string) {
    await this.agent.call({ methodName: "set_agent_pubkey", args: { x25519_pubkey: x25519Pubkey, app_id: appId }, gas: 30n * TGAS });
  }
  async storeReleasedNote(owner: string, noteId: number, heir: string, ciphertextB64: string) {
    await this.agent.call({
      methodName: "store_released_note",
      args: { owner, note_id: noteId, heir, ciphertext: ciphertextB64 },
      gas: 30n * TGAS,
    });
  }
}
