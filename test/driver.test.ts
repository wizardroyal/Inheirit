import { describe, expect, it, vi } from "vitest";
import { Driver, isAdvanceDue, POKE_GAP_MS } from "../src/escalation/driver";
import { stateName, type WillContract, type WillState, type WillView } from "../src/near/will-contract";
import type { SignalAdapter } from "../src/signals/adapters";
import { Store } from "../src/state/store";

const T0 = 1_800_000_000;

function will(state: WillState = "Active", extra: Partial<WillView> = {}): WillView {
  return {
    owner: "alice.testnet",
    heirs: [{ account_id: "bola.testnet", name: "Bola", near_share_bps: 10000, x25519_pubkey: null }],
    guardians: [
      { account_id: "g1.testnet", accepted: true },
      { account_id: "g2.testnet", accepted: true },
    ],
    guardian_threshold: 2,
    contacts: [],
    stages: [
      { pct: 50, wait_after: 30 },
      { pct: 50, wait_after: 10 },
    ],
    accelerated_stages: [{ pct: 100, wait_after: 5 }],
    round_stages: [
      { pct: 50, wait_after: 30 },
      { pct: 50, wait_after: 10 },
    ],
    timings: { quiet_after: 100, nudge_period: 10, welfare_period: 10, vote_period: 50, challenge_period: 10, secrets_buffer: 20 },
    policy_hash: "0".repeat(64),
    foreign_chains: ["Eth"],
    lawyer: null,
    heirs_hidden: true,
    accelerated: false,
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
  it("an unarmed will never leaves Active", () => {
    const unaccepted = will("Active", { guardians: [{ account_id: "g1.testnet", accepted: true }, { account_id: "g2.testnet", accepted: false }] });
    expect(isAdvanceDue(unaccepted, T0 + 10_000)).toBe(false);
  });
  it("each stage waits its own wait_after (the first is the longest)", () => {
    const stage0: WillState = { Executing: { stage: 0, since: T0, stage_started: T0 } };
    expect(isAdvanceDue(will(stage0), T0 + 29)).toBe(false);
    expect(isAdvanceDue(will(stage0), T0 + 30)).toBe(true);
  });
  it("the last stage leads to the secrets buffer only when every foreign stage is done", () => {
    const executing: WillState = { Executing: { stage: 1, since: T0, stage_started: T0 } };
    expect(isAdvanceDue(will(executing), T0 + 10)).toBe(false);
    const done = [{ stage: 0, chain: "Eth" as const }, { stage: 1, chain: "Eth" as const }];
    expect(isAdvanceDue(will(executing, { stage_done: done }), T0 + 10)).toBe(true);
  });
  it("secrets buffer, then Completed once every note is released", () => {
    expect(isAdvanceDue(will({ SecretsBuffer: { since: T0 } }), T0 + 19)).toBe(false);
    expect(isAdvanceDue(will({ SecretsBuffer: { since: T0 } }), T0 + 20)).toBe(true);
    const note = { id: 0, heir: "bola.testnet", label: "Ledger", ciphertext: "" };
    const released: WillState = { SecretsReleased: { since: T0 } };
    expect(isAdvanceDue(will(released, { sealed_notes: [note] }), T0 + 1)).toBe(false);
    expect(isAdvanceDue(will(released, { sealed_notes: [note], released_notes: [{ note_id: 0, heir: "bola.testnet" }] }), T0 + 1)).toBe(true);
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
  it("advances only when due and notifies once per state, as one grouped record", async () => {
    const t = setup({ GuardianVote: { since: T0 + 10 } });
    await t.driver.tick();
    expect(t.contract.calls).toEqual([]);
    t.contract.w.state = { Challenge: { since: T0 + 50 } };
    await t.driver.tick();
    const challenge = t.store.get().notifications.filter((n) => n.event === "Challenge");
    expect(challenge).toHaveLength(1);
    expect(challenge[0].to).toEqual(["alice.testnet", "alice@example.com"]);
    expect(challenge[0].channels).toEqual(["ui"]);
    await t.driver.tick();
    expect(t.store.get().notifications.filter((n) => n.event === "Challenge")).toHaveLength(1);
  });
  it("sends the Quiet checks in order, spaced across the nudge period", async () => {
    const t = setup({ Quiet: { since: T0 + 50 } }, [], { timings: { ...will().timings, nudge_period: 40 } });
    const subjects = () => t.store.get().notifications.filter((n) => n.event === "check").map((n) => n.subject);
    await t.driver.tick();
    expect(subjects()).toEqual(["Check: heartbeat app"]);
    t.setNow(T0 + 60);
    await t.driver.tick();
    expect(subjects()).toEqual(["Check: heartbeat app", "Check: email"]);
    t.setNow(T0 + 80);
    await t.driver.tick();
    // Telegram (step 3) is skipped without a bot; the SIMULATED DM is step 4.
    expect(subjects()).toEqual(["Check: heartbeat app", "Check: email", "Check: DM (SIMULATED)"]);
    await t.driver.tick();
    expect(subjects()).toHaveLength(3);
  });
  it("tells guardians when the vote opens", async () => {
    const t = setup({ WelfareCheck: { since: T0 } });
    t.setNow(T0 + 10);
    await t.driver.tick();
    expect(t.store.get().notifications.filter((n) => n.event === "GuardianVote").flatMap((n) => n.to)).toEqual(["g1.testnet", "g2.testnet"]);
  });
  it("asks only accepted guardians to vote", async () => {
    const t = setup({ WelfareCheck: { since: T0 } }, [], {
      guardians: [{ account_id: "g1.testnet", accepted: true }, { account_id: "g2.testnet", accepted: true }, { account_id: "g3.testnet", accepted: false }],
    });
    t.setNow(T0 + 10);
    await t.driver.tick();
    expect(t.store.get().notifications.filter((n) => n.event === "GuardianVote").flatMap((n) => n.to)).toEqual(["g1.testnet", "g2.testnet"]);
  });
  it("the welfare check asks guardians, then friends, then the lawyer", async () => {
    const t = setup({ Quiet: { since: T0 } }, [], { lawyer: "lawyer.testnet" });
    t.store.update((s) => (s.policies["alice.testnet"] = { contacts: ["friend@example.com"] } as never));
    t.setNow(T0 + 10);
    await t.driver.tick();
    expect(t.store.get().notifications.filter((n) => n.subject.startsWith("Have you heard")).flatMap((n) => n.to)).toEqual([
      "g1.testnet",
      "g2.testnet",
      "friend@example.com",
      "lawyer.testnet",
    ]);
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
    await t.driver.idle();
    expect(t.executed).toEqual(["alice.testnet"]);
    expect(t.noted, "secrets last: never while funds are moving").toEqual([]);
  });
  it("releases notes only in SecretsReleased", async () => {
    const released = setup({ SecretsReleased: { since: T0 + 40 } });
    await released.driver.tick();
    expect(released.noted).toEqual(["SecretsReleased"]);
    for (const state of [{ Challenge: { since: T0 + 40 } }, { SecretsBuffer: { since: T0 + 40 } }, { Completed: { at: T0 } }] as WillState[]) {
      const t = setup(state);
      await t.driver.tick();
      expect(t.noted).toEqual([]);
    }
  });
});

describe("Telegram delivery", () => {
  function withBot(linked: string[]) {
    const sent: [string, string][] = [];
    const telegram = {
      isLinked: (a: string) => linked.includes(a),
      notify: async (a: string, text: string) => (linked.includes(a) ? (sent.push([a, text]), true) : false),
    };
    const store = new Store(null);
    store.update((s) => (s.owners["alice.testnet"] = { owner: "alice.testnet" }));
    let nowS = T0 + 50;
    const contract = new FakeContract(will({ Quiet: { since: T0 + 50 } }, { timings: { ...will().timings, nudge_period: 40 } }), () => nowS);
    const driver = new Driver({ contract, adapters: [], store, telegram, now: () => new Date(nowS * 1000), log: () => {} });
    return { driver, store, contract, sent, setNow: (s: number) => (nowS = s) };
  }
  it("sends the owner's Telegram check when it is due", async () => {
    const t = withBot(["alice.testnet"]);
    t.setNow(T0 + 80);
    await t.driver.tick();
    expect(t.sent.map(([a]) => a)).toEqual(["alice.testnet"]);
    expect(t.sent[0][1]).toMatch(/Reply with anything/);
    const tg = t.store.get().notifications.find((n) => n.subject === "Check: Telegram");
    expect(tg?.channels).toEqual(["telegram"]);
  });
  it("does not re-send the Telegram check after an expired vote restarts the ladder (same silence)", async () => {
    const t = withBot(["alice.testnet"]);
    t.setNow(T0 + 80);
    await t.driver.tick();
    expect(t.sent).toHaveLength(1);
    // Vote expired -> Active with the same last_alive_at -> Quiet again later.
    t.contract.w.state = { Quiet: { since: T0 + 500 } };
    t.setNow(T0 + 530);
    await t.driver.tick();
    expect(t.sent).toHaveLength(1);
    expect(t.store.get().notifications.some((n) => n.subject.startsWith("Check: Telegram (not sent again"))).toBe(true);
    // A new sign of life starts a new silence: the next check goes out again.
    t.contract.w.last_alive_at = T0 + 600;
    t.contract.w.state = { Quiet: { since: T0 + 900 } };
    t.setNow(T0 + 930);
    await t.driver.tick();
    expect(t.sent).toHaveLength(2);
  });
  it("re-sends the challenge alarm but not a repeat guardian vote in the same silence", async () => {
    const t = withBot(["g1.testnet", "alice.testnet"]);
    for (const [i, state] of ([{ GuardianVote: { since: T0 } }, "Active", { GuardianVote: { since: T0 + 400 } }] as WillState[]).entries()) {
      t.contract.w.state = state;
      t.setNow(T0 + 10 + i * 400);
      await t.driver.tick();
    }
    expect(t.sent.filter(([a]) => a === "g1.testnet")).toHaveLength(1);
    const votes = t.store.get().notifications.filter((n) => n.event === "GuardianVote");
    expect(votes.map((n) => n.channels)).toEqual([["ui", "telegram"], ["ui", "telegram (already sent during this silence)"]]);
    for (const [i, state] of ([{ Challenge: { since: T0 + 900 } }, "Active", { Challenge: { since: T0 + 1300 } }] as WillState[]).entries()) {
      t.contract.w.state = state;
      t.setNow(T0 + 910 + i * 400);
      await t.driver.tick();
    }
    expect(t.sent.filter(([a, text]) => a === "alice.testnet" && text.startsWith("Your will starts releasing"))).toHaveLength(2);
  });
  it("adds telegram to an event's channels when a recipient is linked", async () => {
    const t = withBot(["g1.testnet"]);
    t.contract.w.state = { GuardianVote: { since: T0 } };
    await t.driver.tick();
    const vote = t.store.get().notifications.find((n) => n.event === "GuardianVote");
    expect(vote?.channels).toEqual(["ui", "telegram"]);
    expect(t.sent.map(([a]) => a)).toEqual(["g1.testnet"]);
  });
});

describe("demo watch expiry and rate limits", () => {
  const HOUR = 3_600_000;
  function setup(state: WillState, watchedSince: string, nowMs: number) {
    const store = new Store(null);
    store.update((s) => (s.owners["alice.testnet"] = { owner: "alice.testnet", watchedSince }));
    const contract = new FakeContract(will(state), () => Math.floor(nowMs / 1000));
    const driver = new Driver({ contract, adapters: [], store, now: () => new Date(nowMs), log: () => {}, demoWatchMs: 3 * HOUR });
    return { store, contract, driver };
  }
  const since = new Date(T0 * 1000).toISOString();

  it("stops driving a demo will after the watch period", async () => {
    const t = setup("Active", since, T0 * 1000 + 4 * HOUR);
    await t.driver.tick();
    expect(t.store.get().owners["alice.testnet"]).toBeUndefined();
    expect(t.contract.calls).toEqual([]);
  });
  it("keeps driving a demo will that is mid-execution", async () => {
    const t = setup({ Executing: { stage: 0, since: T0, stage_started: T0 } }, since, T0 * 1000 + 4 * HOUR);
    await t.driver.tick();
    expect(t.store.get().owners["alice.testnet"]).toBeDefined();
  });
  it("keeps driving within the watch period", async () => {
    const t = setup("Active", since, T0 * 1000 + HOUR);
    await t.driver.tick();
    expect(t.store.get().owners["alice.testnet"]).toBeDefined();
  });
  it("skips the rest of a tick when the RPC rate-limits", async () => {
    const store = new Store(null);
    const owners = Array.from({ length: 10 }, (_, i) => `o${i}.testnet`);
    for (const o of owners) store.update((s) => (s.owners[o] = { owner: o }));
    let calls = 0;
    const contract = {
      getWill: async () => {
        calls++;
        throw new Error('{"code": -429, "message": "Rate limits exceeded"}');
      },
    } as unknown as WillContract;
    await new Driver({ contract, adapters: [], store, log: () => {}, concurrency: 3 }).tick();
    // Owners already in flight finish; no new ones start
    expect(calls).toBe(3);
  });
  it("keeps driving an expired speedrun will in GuardianVote or Challenge (anyone's advance could start a release)", async () => {
    for (const state of [{ GuardianVote: { since: T0 } }, { Challenge: { since: T0 } }] as WillState[]) {
      const t = setup(state, since, T0 * 1000 + 4 * HOUR);
      await t.driver.tick();
      expect(t.store.get().owners["alice.testnet"]).toBeDefined();
    }
  });
  it("never expires a will with real timings", async () => {
    const store = new Store(null);
    store.update((s) => (s.owners["alice.testnet"] = { owner: "alice.testnet", watchedSince: since }));
    const real = will("Active", { timings: { quiet_after: 90 * 86400, nudge_period: 7 * 86400, welfare_period: 7 * 86400, vote_period: 30 * 86400, challenge_period: 30 * 86400, secrets_buffer: 30 * 86400 } });
    const contract = new FakeContract(real, () => T0 + 10 * 24 * 3600);
    const driver = new Driver({ contract, adapters: [], store, now: () => new Date((T0 + 10 * 24 * 3600) * 1000), log: () => {}, demoWatchMs: 3 * HOUR });
    await driver.tick();
    expect(store.get().owners["alice.testnet"]).toBeDefined();
  });
});

describe("poke: act on a sign of life at once", () => {
  it("ticks the poked will right away and records the sign of life", async () => {
    let heartbeat: Date | null = null;
    const t = setup({ Quiet: { since: T0 + 30 } }, [adapter("phone_heartbeat", 0.9, () => heartbeat)]);
    heartbeat = new Date((T0 + 45) * 1000);
    await t.driver.poke("alice.testnet");
    expect(t.contract.calls).toEqual([`record_liveness ${T0 + 45}`]);
    expect(t.contract.w.state).toBe("Active");
  });
  it("ignores owners the agent doesn't watch", async () => {
    const t = setup();
    await t.driver.poke("stranger.testnet");
    expect(t.contract.calls).toEqual([]);
  });
  it("never runs the same will twice at once (poke during a tick)", async () => {
    const t = setup();
    let inside = 0;
    let maxInside = 0;
    const slow = t.driver.tickOwner.bind(t.driver);
    t.driver.tickOwner = async (cfg) => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setTimeout(r, 30));
      await slow(cfg);
      inside--;
    };
    await Promise.all([t.driver.tick(), t.driver.poke("alice.testnet"), t.driver.poke("alice.testnet")]);
    expect(maxInside).toBe(1);
  });
  it("merges a flood of pokes into one waiting tick, spaced POKE_GAP_MS apart", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      let runs = 0;
      t.driver.tickOwner = async () => {
        runs++;
      };
      await t.driver.poke("alice.testnet");
      expect(runs).toBe(1);
      // 50 signed heartbeats within the gap: one more tick, after the gap
      const flood = Array.from({ length: 50 }, () => t.driver.poke("alice.testnet"));
      expect(new Set(flood).size).toBe(1);
      await vi.advanceTimersByTimeAsync(POKE_GAP_MS);
      await Promise.all(flood);
      expect(runs).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("capacity: parallel ticks and the execution queue", () => {
  function many(n: number, state: WillState, slowMs: number, opts: { concurrency?: number; executionConcurrency?: number } = {}) {
    const store = new Store(null);
    const owners = Array.from({ length: n }, (_, i) => `o${i}.testnet`);
    for (const o of owners) store.update((s) => (s.owners[o] = { owner: o }));
    const nowS = T0 + 50;
    const contract = {
      getWill: async (owner: string) => {
        await new Promise((r) => setTimeout(r, slowMs));
        return { ...will(state), owner };
      },
      recordLiveness: async () => {},
      advance: async () => false,
    } as unknown as WillContract;
    const started: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const executor = {
      run: async (o: string) => {
        started.push(o);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 200));
        inFlight--;
      },
    };
    const driver = new Driver({ contract, adapters: [], store, now: () => new Date(nowS * 1000), log: () => {}, executor, ...opts });
    return { driver, started, maxInFlight: () => maxInFlight };
  }

  it("ticks owners in parallel", async () => {
    const t = many(8, "Active", 50, { concurrency: 4 });
    const start = Date.now();
    await t.driver.tick();
    // 8 owners x 50 ms one by one would take 400 ms
    expect(Date.now() - start).toBeLessThan(300);
  });
  it("a slow execution doesn't hold up the tick, and runs at most executionConcurrency at once", async () => {
    const t = many(5, { Executing: { stage: 0, since: T0, stage_started: T0 + 45 } }, 1, { executionConcurrency: 2 });
    const start = Date.now();
    await t.driver.tick();
    expect(Date.now() - start, "tick returns before the 200 ms executions").toBeLessThan(150);
    await t.driver.idle();
    expect(t.started.sort()).toEqual(["o0.testnet", "o1.testnet", "o2.testnet", "o3.testnet", "o4.testnet"]);
    expect(t.maxInFlight()).toBe(2);
  });
  it("doesn't start a second execution for an owner while one is in flight", async () => {
    const t = many(1, { Executing: { stage: 0, since: T0, stage_started: T0 + 45 } }, 1);
    await t.driver.tick();
    await t.driver.tick();
    await t.driver.idle();
    expect(t.started).toEqual(["o0.testnet"]);
  });
});
