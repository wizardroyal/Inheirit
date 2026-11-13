import { describe, expect, it } from "vitest";
import { explainLiveness } from "../src/liveness/verdict";
import type { Observation } from "../src/liveness/score";
import type { WillState, WillView } from "../src/near/will-contract";

const now = new Date("2026-11-05T12:00:00Z");
const nowS = now.getTime() / 1000;
const ago = (s: number) => new Date(now.getTime() - s * 1000);

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
    stages: [{ pct: 100, wait_after: 1 }],
    accelerated_stages: [{ pct: 100, wait_after: 1 }],
    round_stages: [],
    timings: { quiet_after: 3600, nudge_period: 60, welfare_period: 60, vote_period: 300, challenge_period: 120, secrets_buffer: 60 },
    policy_hash: "0".repeat(64),
    foreign_chains: [],
    lawyer: null,
    heirs_hidden: true,
    accelerated: false,
    state,
    last_alive_at: nowS - 600,
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
const o = (source: Observation["source"], secsAgo: number, trustWeight: number, simulated = false): Observation => ({
  source,
  at: ago(secsAgo),
  trustWeight,
  simulated,
});

describe("explainLiveness", () => {
  it("names the strong signal that counts", () => {
    const v = explainLiveness(will(), [o("near_onchain", 600, 0.9)], now);
    expect(v.headline).toBe("Alive. Last strong signal: NEAR transaction 10 minutes ago.");
    expect(v.ignored).toEqual([]);
  });
  it("at All good a lone post newer than the last strong signal only postpones the checks (2026-11-13)", () => {
    const v = explainLiveness(will(), [o("near_onchain", 600, 0.9), o("x", 60, 0.4, true)], now);
    expect(v.headline).toMatch(/On its own it only postpones the checks/);
  });
  it("explains why a lone post is ignored once checks have started", () => {
    const v = explainLiveness(will({ Quiet: { since: nowS - 60 } }, { last_alive_at: nowS - 600 }), [o("near_onchain", 600, 0.9), o("x", 60, 0.4, true)], now);
    expect(v.details.find((d) => d.startsWith("One X post"))).toBe(
      "One X post (SIMULATED) seen 60 seconds ago; ignored on its own because posts can be scheduled or run by someone else; it counts only if another independent source agrees within 24 hours.",
    );
  });
  it("two weak sources that agree are named together", () => {
    const v = explainLiveness(will("Active", { last_alive_at: nowS - 7200 }), [o("x", 60, 0.4, true), o("instagram", 120, 0.4, true)], now);
    expect(v.headline).toMatch(/Two independent signals agree: X post \(SIMULATED\) and Instagram post \(SIMULATED\)/);
    expect(v.ignored).toEqual([]);
  });
  it("says when a will is not armed", () => {
    const v = explainLiveness(will("Active", { guardians: [{ account_id: "g1.testnet", accepted: true }, { account_id: "g2.testnet", accepted: false }] }), [], now);
    expect(v.details.join(" ")).toMatch(/Not armed: 1 of 2 required guardians have accepted/);
  });
  it("puts the silence next to the owner's usual rhythm when the history says what's usual", () => {
    const q = explainLiveness(will({ Quiet: { since: nowS - 60 } }, { last_alive_at: nowS - 9 * 86400 }), [], now, undefined, 3 * 86400);
    expect(q.headline).toBe("Quiet for 9 days (usually active every 3 days), so we're checking in: the heartbeat app, then email, Telegram and DMs. Any reply stops it.");
    const a = explainLiveness(will(), [], now, undefined, 8 * 3600);
    expect(a.details).toContain("Usually active every 8 hours, from the last 90 days of transactions.");
    // No history: no claim about what's usual.
    expect(explainLiveness(will({ Quiet: { since: nowS - 60 } }, { last_alive_at: nowS - 9 * 86400 }), [], now).headline).not.toContain("usually");
  });

  it("describes Quiet with how long and what happens next", () => {
    const v = explainLiveness(will({ Quiet: { since: nowS - 60 } }, { last_alive_at: nowS - 9 * 86400 }), [], now);
    expect(v.headline).toBe("Quiet for 9 days, so we're checking in: the heartbeat app, then email, Telegram and DMs. Any reply stops it.");
  });
  it("names only the people a WelfareCheck actually asks", () => {
    const ws = { WelfareCheck: { since: nowS - 60 } };
    expect(explainLiveness(will(ws), [], now).headline).toMatch(/Guardians are asked/);
    expect(explainLiveness(will(ws, { contacts: ["f.testnet"], lawyer: "l.testnet" }), [], now).headline).toMatch(
      /Guardians, friends and the lawyer are asked/,
    );
  });
  it("does not say Alive when an Active will is already overdue (e.g. after an expired vote)", () => {
    const v = explainLiveness(will("Active", { last_alive_at: nowS - 7200 }), [o("near_onchain", 7200, 0.9)], now);
    expect(v.headline).toMatch(/^No sign of life for 2 hours; the checks start again shortly\./);
  });
  it("flags timestamps in the future", () => {
    const v = explainLiveness(will(), [{ ...o("near_onchain", 0, 0.9), at: new Date(now.getTime() + 3600_000) }], now);
    expect(v.ignored[0].reason).toMatch(/future/);
  });
});
