import { describe, expect, it } from "vitest";
import { canonicalJson, checkPolicy, nearShareBps, policyHash } from "../src/policy/policy";

const ETH1 = "0x" + "a".repeat(40);
const BTC1 = "tb1qjzz0h4l7j3m9x7w6y8ezlmdslr7zfy75zqj7zg";

function base() {
  return {
    version: 1,
    owner: "alice.testnet",
    heirs: [
      { id: "h1", name: "Bola", near_account: "bola.testnet", receive: { eth: ETH1, btc: BTC1 } },
      { id: "h2", name: "Charity Fund", near_account: "charity.testnet", receive: { eth: "0x2222222222222222222222222222222222222222" } },
    ],
    allocations: [
      { asset: "NEAR", shares: { h1: 80, h2: 20 } },
      { asset: "ETH", shares: { h1: 100 } },
      { asset: "BTC", shares: { h1: 100 } },
    ],
    conditions: [{ heir: "h1", asset: "BTC", type: "not_before", date: "2031-05-01" }],
    stages_pct: [10, 30, 60],
    guardians: ["g1.testnet", "g2.testnet", "g3.testnet"],
    guardian_threshold: 2,
    contacts: ["friend@example.com"],
  } as any;
}

function errorsOf(mutate: (p: any) => void): string[] {
  const p = base();
  mutate(p);
  const r = checkPolicy(p);
  return r.ok ? [] : r.errors;
}

describe("checkPolicy", () => {
  it("accepts the §7.6 example", () => {
    expect(checkPolicy(base()).ok).toBe(true);
  });
  it("rejects shares not summing to 100", () => {
    expect(errorsOf((p) => (p.allocations[0].shares.h2 = 10))).toContain("The NEAR shares add up to 90%, not 100%.");
  });
  it("rejects an unknown heir in allocations", () => {
    expect(errorsOf((p) => (p.allocations[1].shares = { h9: 100 }))).toEqual(["Part of the ETH goes to \"h9\", who isn't one of the heirs."]);
  });
  it("rejects two heirs sharing a receive address (records couldn't tell them apart)", () => {
    expect(errorsOf((p) => (p.heirs[1].receive.eth = p.heirs[0].receive.eth!.toUpperCase().replace("0X", "0x")))).toContain("Two heirs have the same Ethereum receive address; each heir needs their own.");
  });
  it("requires a receive address for a foreign-chain share", () => {
    expect(errorsOf((p) => (p.allocations[2].shares = { h2: 100 }))).toContain("Charity Fund gets BTC but has no Bitcoin address to receive it.");
  });
  it("rejects stages not summing to 100", () => {
    expect(errorsOf((p) => (p.stages_pct = [10, 30]))).toContain("The release stages add up to 40%, not 100%.");
  });
  it("requires a NEAR allocation", () => {
    expect(errorsOf((p) => p.allocations.shift())[0]).toMatch(/Say who gets the NEAR/);
  });
  it("rejects a guardian who is also an heir", () => {
    expect(errorsOf((p) => (p.guardians[0] = "bola.testnet"))).toContain("bola.testnet can't be both a guardian and an heir.");
  });
  it("rejects mainnet BTC addresses", () => {
    expect(errorsOf((p) => (p.heirs[0].receive.btc = "bc1qjzz0h4l7j3m9x7w6y8ezlmdslr7zfy75zqj7zg")).join()).toMatch(/Bitcoin testnet address/);
  });
  it("reports schema errors instead of throwing", () => {
    expect(errorsOf((p) => (p.version = 2)).length).toBeGreaterThan(0);
  });
});

describe("policyHash", () => {
  it("does not depend on key order", () => {
    const a = checkPolicy(base());
    const reordered = Object.fromEntries(Object.entries(base()).reverse());
    const b = checkPolicy(reordered);
    if (!a.ok || !b.ok) throw new Error("invalid");
    expect(policyHash(a.policy)).toBe(policyHash(b.policy));
    expect(policyHash(a.policy)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when content changes", () => {
    const a = checkPolicy(base());
    const p = base();
    p.stages_pct = [20, 20, 60];
    const b = checkPolicy(p);
    if (!a.ok || !b.ok) throw new Error("invalid");
    expect(policyHash(a.policy)).not.toBe(policyHash(b.policy));
  });
  it("canonical JSON sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: "x" }] })).toBe('{"a":[{"c":"x"}],"b":1}');
  });
});

it("nearShareBps maps percent to basis points per NEAR account", () => {
  const r = checkPolicy(base());
  if (!r.ok) throw new Error("invalid");
  expect(nearShareBps(r.policy)).toEqual({ "bola.testnet": 8000, "charity.testnet": 2000 });
});
