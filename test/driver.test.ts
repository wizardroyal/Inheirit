import { describe, expect, it } from "vitest";
import { Driver, isAdvanceDue } from "../src/escalation/driver";
import { stateName, type WillContract, type WillState, type WillView } from "../src/near/will-contract";
import type { SignalAdapter } from "../src/signals/adapters";
import { Store } from "../src/state/store";

const T0 = 1_800_000_000;

function will(state: WillState = "Active", extra: Partial<WillView> = {}): WillView {
  return {
    owner: "alice.testnet",
    heirs: [{ account_id: "bola.testnet", name: "Bola", near_share_bps: 10000, x25519_pubkey: null }],
    guardians: ["g1.testnet", "g2.testnet"],
    guardian_threshold: 2,
    contacts: [],
    stages_pct: [50, 50],
    timings: { quiet_after: 100, nudge_period: 10, welfare_period: 10, vote_period: 50, challenge_period: 10, stage_interval: 10 },
    policy_hash: "0".repeat(64),
    foreign_chains: ["Eth"],
    state,
    last_alive_at: T0,
    execution_round: 0,
    near_balance: "0",
    pending_withdrawals: [],
    executions: [],
    stage_done: [],
    sealed_notes: [],
    released_notes: [],
    ...extra,
  };
}

class FakeContract implements WillContract {
  calls: string[] = [];
  constructor(public w: WillView, private readonly nowS: () => number) {}
  async getWill() {
    return structuredClone(this.w);
  }
  async recordLiveness(_o: string, at: number) {
    this.calls.push(`record_liveness ${at}`);
    this.w.last_alive_at = at;
    if (this.w.state !== "Active") this.w.state = "Active";
    return true;
  }
  async advance() {
    this.calls.push("advance");
    const n = this.nowS();
    if (this.w.state === "Active") this.w.state = { Quiet: { since: n } };
    else if ("Quiet" in this.w.state) this.w.state = { WelfareCheck: { since: n } };
    else if ("WelfareCheck" in this.w.state) this.w.state = { GuardianVote: { since: n } };
    return true;
  }
  async requestSignature() {
    return {};
  }
  async recordExecution() {}
  async markStageDone() {}
  async completeWithdrawal() {}
  async getAgentPubkey() {
    return null;
  }
  async setAgentPubkey() {}
  async storeReleasedNote() {}
}

function adapter(source: SignalAdapter["source"], trustWeight: number, at: () => Date | null | Error): SignalAdapter {
  return {
    source,
    trustWeight,
    simulated: false,
    async lastActivity() {
      const v = at();
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

function setup(state: WillState = "Active", adapters: SignalAdapter[] = [], extra: Partial<WillView> = {}) {
  let nowS = T0 + 50;
  const store = new Store(null);
  store.update((s) => (s.owners["alice.testnet"] = { owner: "alice.testnet", email: "alice@example.com" }));
  const contract = new FakeContract(will(state, extra), () => nowS);
  const logs: string[] = [];
  const executed: string[] = [];
  const noted: string[] = [];
  const driver = new Driver({
    contract,
    adapters,
    store,
    now: () => new Date(nowS * 1000),
    log: (m) => logs.push(m),
    executor: { run: async (o) => void executed.push(o) },
    notes: { run: async (w) => (noted.push(stateName(w.state)), 0) },
  });
  return { driver, contract, store, logs, executed, noted, setNow: (s: number) => (nowS = s), getNow: () => nowS };
}

describe("isAdvanceDue", () => {
  it("follows each period", () => {
    expect(isAdvanceDue(will(), T0 + 99)).toBe(false);
    expect(isAdvanceDue(will(), T0 + 100)).toBe(true);
    expect(isAdvanceDue(will({ GuardianVote: { since: T0 } }), T0 + 50)).toBe(true);
  });
  it("last stage completes only when every foreign stage is done", () => {
    const executing: WillState = { Executing: { stage: 1, since: T0, stage_started: T0 } };
    expect(isAdvanceDue(will(executing), T0 + 10)).toBe(false);
    const done = [{ stage: 0, chain: "Eth" as const }, { stage: 1, chain: "Eth" as const }];
    expect(isAdvanceDue(will(executing, { stage_done: done }), T0 + 10)).toBe(true);
  });
});

describe("Driver", () => {
  it("reports a newer strong signal on-chain, kept behind the chain clock", async () => {
    const t = setup("Active", [adapter("near_onchain", 0.9, () => new Date((T0 + 49) * 1000))]);
    await t.driver.tick();
    expect(t.contract.calls).toEqual([`record_liveness ${T0 + 45}`]);
  });
  it("does not report a lone weak signal", async () => {
    const t = setup("Active", [adapter("x", 0.4, () => new Date((T0 + 40) * 1000))]);
    await t.driver.tick();
    expect(t.contract.calls).toEqual([]);
  });
  it("a sign of life during an escalation returns the will to Active", async () => {
    const t = setup({ Quiet: { since: T0 + 10 } }, [adapter("phone_heartbeat", 0.9, () => new Date((T0 + 30) * 1000))]);
    await t.driver.tick();
    expect(t.contract.w.state).toBe("Active");
  });
  it("advances only when due and notifies once per state", async () => {
    const t = setup("Active");
    await t.driver.tick();
    expect(t.contract.calls).toEqual([]);
    t.setNow(T0 + 100);
    await t.driver.tick();
    expect(t.contract.calls).toEqual(["advance"]);
    const toOwner = t.store.get().notifications.filter((n) => n.subject === "Are you there?").map((n) => n.to);
    expect(toOwner).toContain("alice@example.com");
    await t.driver.tick();
    expect(t.store.get().notifications.filter((n) => n.subject === "Are you there?")).toHaveLength(toOwner.length);
  });
  it("tells guardians when the vote opens", async () => {
    const t = setup({ WelfareCheck: { since: T0 } });
    t.setNow(T0 + 10);
    await t.driver.tick();
    expect(t.store.get().notifications.filter((n) => n.subject.startsWith("Guardian vote")).map((n) => n.to)).toEqual(["g1.testnet", "g2.testnet"]);
  });
  it("a failing adapter is logged and does not count as silence or activity", async () => {
    const t = setup("Active", [adapter("github", 0.5, () => new Error("rate limited"))]);
    await t.driver.tick();
    expect(t.logs.some((l) => l.includes("github") && l.includes("rate limited"))).toBe(true);
    expect(t.contract.calls).toEqual([]);
  });
  it("hands Executing wills to the executor", async () => {
    const t = setup({ Executing: { stage: 0, since: T0, stage_started: T0 + 45 } });
    await t.driver.tick();
    expect(t.executed).toEqual(["alice.testnet"]);
    expect(t.noted).toEqual(["Executing"]);
  });
  it("releases notes for Completed wills but never before execution", async () => {
    const done = setup({ Completed: { at: T0 } });
    await done.driver.tick();
    expect(done.noted).toEqual(["Completed"]);
    const challenge = setup({ Challenge: { since: T0 + 40 } });
    await challenge.driver.tick();
    expect(challenge.noted).toEqual([]);
  });
});
