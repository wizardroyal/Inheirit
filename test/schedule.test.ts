import { describe, expect, it } from "vitest";
import { checkPolicy } from "../src/policy/policy";
import { DEMO_SCHEDULE, REAL_SCHEDULE, STANDARD_PCT, stagesFor, summarize } from "../src/policy/schedule";

describe("release schedules", () => {
  it("gives the first slice the longest wait", () => {
    expect(stagesFor(STANDARD_PCT, DEMO_SCHEDULE)).toEqual([
      { pct: 10, wait_after: 180 },
      { pct: 20, wait_after: 60 },
      { pct: 30, wait_after: 60 },
      { pct: 40, wait_after: 60 },
    ]);
  });
  it("accelerated presets sum to 100", () => {
    for (const p of [DEMO_SCHEDULE, REAL_SCHEDULE]) expect(p.accelerated.reduce((s, x) => s + x.pct, 0)).toBe(100);
  });
  it("summarizes earliest move, full distribution and secrets", () => {
    const stages = stagesFor(STANDARD_PCT, DEMO_SCHEDULE);
    // quiet 120 + nudge 60 + welfare 60 + challenge 120 = 360; + waits 180+60+60 = 660; + 60 + buffer 60 = 780
    expect(summarize(DEMO_SCHEDULE.timings, stages)).toEqual({ earliestMove: 360, fullDistribution: 660, secrets: 780 });
  });
  it("real defaults: first slice after ~5 months of silence, full distribution in ~17 months, secrets ~23", () => {
    const s = summarize(REAL_SCHEDULE.timings, stagesFor(STANDARD_PCT, REAL_SCHEDULE));
    // quiet 30 + checks 7 + welfare 14 + challenge 60 = 111 d; + 180 + 90 + 90 = 471 d; + 90 + secrets 90 = 651 d
    expect([s.earliestMove, s.fullDistribution, s.secrets].map((x) => x / 86_400)).toEqual([141, 501, 681]);
  });
});

describe("policy lawyer and sign-up fields", () => {
  const base = {
    version: 1,
    owner: "alice.testnet",
    heirs: [{ id: "h1", name: "Bola", near_account: "bola.testnet" }],
    allocations: [{ asset: "NEAR", shares: { h1: 100 } }],
    stages_pct: STANDARD_PCT,
    guardians: ["g1.testnet"],
    guardian_threshold: 1,
    display_name: "Alice",
  };
  it("accepts a lawyer who is not an heir", () => {
    expect(checkPolicy({ ...base, lawyer: "lawyer.testnet", jurisdiction: "Nigeria" }).ok).toBe(true);
  });
  it("rejects a lawyer who is an heir or the owner", () => {
    for (const lawyer of ["bola.testnet", "alice.testnet"]) {
      const r = checkPolicy({ ...base, lawyer });
      expect(r.ok).toBe(false);
    }
  });
});
