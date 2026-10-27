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
}

export interface Notification {
  at: string;
  owner: string;
  to: string;
  channel: "ui" | "email";
  subject: string;
  body: string;
}

export interface AgentState {
  owners: Record<string, OwnerSignalConfig>;
  policies: Record<string, Policy>;
  /** SIMULATED signals written by the demo panel: owner -> source -> ISO time. */
  simulated: Record<string, Partial<Record<SignalSource, string>>>;
  /** EVM nonce tracking for the evm_onchain adapter: owner -> { nonce, seenAt }. */
  evmNonces: Record<string, { nonce: number; seenAt: string }>;
  /** Foreign vault balances at execution start: `${owner}:${round}:${chain}` -> smallest units. */
  snapshots: Record<string, string>;
  /** Last will state the driver notified about: owner -> state name. */
  notifiedState: Record<string, string>;
  notifications: Notification[];
}

const EMPTY: AgentState = {
  owners: {},
  policies: {},
  simulated: {},
  evmNonces: {},
  snapshots: {},
  notifiedState: {},
  notifications: [],
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
