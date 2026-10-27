import { describe, expect, it } from "vitest";
import { api } from "../src/api";
import type { WillContract, WillView } from "../src/near/will-contract";
import { checkPolicy, policyHash } from "../src/policy/policy";
import { Store } from "../src/state/store";

const policyInput = {
  version: 1,
  owner: "alice.testnet",
  heirs: [{ id: "h1", name: "Bola", near_account: "bola.testnet" }],
  allocations: [{ asset: "NEAR", shares: { h1: 100 } }],
  stages_pct: [100],
  guardians: ["g1.testnet"],
  guardian_threshold: 1,
};
const parsed = checkPolicy(policyInput);
if (!parsed.ok) throw new Error("bad fixture");
const HASH = policyHash(parsed.policy);

function setup(demoMode: boolean, onChainHash = HASH) {
  const store = new Store(null);
  const contract = {
    getWill: async (owner: string) => (owner === "alice.testnet" ? ({ owner, policy_hash: onChainHash, state: "Active" } as WillView) : null),
  } as unknown as WillContract;
  const app = api({ contract, store, vaults: [], demoMode, agentInfo: async () => ({}) });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return { store, post };
}

describe("POST /api/policy", () => {
  it("accepts a policy whose hash is the will's policy_hash", async () => {
    const t = setup(false);
    const res = await t.post("/api/policy", { owner: "alice.testnet", policy: policyInput });
    expect(res.status).toBe(200);
    expect(t.store.get().policies["alice.testnet"]).toBeDefined();
  });
  it("rejects a policy the owner did not approve on-chain", async () => {
    const t = setup(false, "f".repeat(64));
    const res = await t.post("/api/policy", { owner: "alice.testnet", policy: policyInput });
    expect(res.status).toBe(409);
    expect(t.store.get().policies["alice.testnet"]).toBeUndefined();
  });
  it("returns every validation error", async () => {
    const t = setup(false);
    const res = await t.post("/api/policy", { owner: "alice.testnet", policy: { ...policyInput, stages_pct: [50] } });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toContain("stages_pct: sums to 50, not 100");
  });
});

describe("demo-only routes", () => {
  it("simulated signals are refused outside demo mode", async () => {
    expect((await setup(false).post("/demo/signal", { owner: "alice.testnet", source: "x" })).status).toBe(403);
  });
  it("records a SIMULATED signal in demo mode", async () => {
    const t = setup(true);
    const res = await t.post("/demo/signal", { owner: "alice.testnet", source: "x", at: "2026-11-01T00:00:00Z" });
    expect(await res.json()).toMatchObject({ ok: true, simulated: true });
    expect(t.store.get().simulated["alice.testnet"]).toEqual({ x: "2026-11-01T00:00:00Z" });
  });
  it("only simulated sources can be written", async () => {
    expect((await setup(true).post("/demo/signal", { owner: "alice.testnet", source: "near_onchain" })).status).toBe(400);
  });
  it("owner registration is demo-only until owner signatures exist", async () => {
    expect((await setup(false).post("/api/owners", { owner: "alice.testnet" })).status).toBe(403);
    expect((await setup(true).post("/api/owners", { owner: "alice.testnet", github: "alice" })).status).toBe(200);
  });
});
