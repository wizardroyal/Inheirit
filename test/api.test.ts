import { describe, expect, it } from "vitest";
import { api, type ApiDeps } from "../src/api";
import { AuthError, type SignedAction } from "../src/auth/nep413";
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

// Stand-in for Nep413Verifier (tested in nep413.test.ts): `signed` is the already-verified message
const verifier = {
  async verify(input: unknown, action: SignedAction) {
    const m = input as { owner: string; action: SignedAction; data?: unknown; bad?: boolean };
    if (m.bad || m.action !== action) throw new AuthError("bad signature");
    return { owner: m.owner, action, issuedAt: 0, data: m.data };
  },
};

function setup(demoMode: boolean, onChainHash = HASH, ai?: ApiDeps["ai"], extra: Partial<ApiDeps> = {}) {
  const store = new Store(null);
  const contract = {
    getWill: async (owner: string) => (owner === "alice.testnet" ? ({ owner, policy_hash: onChainHash, state: "Active", heirs: [{ account_id: "bola.testnet" }], foreign_chains: ["Eth", "Btc"] } as WillView) : null),
  } as unknown as WillContract;
  const app = api({ contract, store, vaults: [], demoMode, agentInfo: async () => ({}), auth: verifier, ai, ...extra });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return { store, post, app };
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
  it("unsigned owner registration works only in demo mode", async () => {
    expect((await setup(false).post("/api/owners", { owner: "alice.testnet" })).status).toBe(403);
    expect((await setup(true).post("/api/owners", { owner: "alice.testnet", github: "alice" })).status).toBe(200);
  });
});

describe("owner-signed routes", () => {
  it("registers signal identities from a signed request outside demo mode", async () => {
    const t = setup(false);
    const res = await t.post("/api/owners", { signed: { owner: "alice.testnet", action: "register_owner", data: { github: "alice" } } });
    expect(await res.json()).toMatchObject({ ok: true, signed: true });
    expect(t.store.get().owners["alice.testnet"]).toEqual({ owner: "alice.testnet", github: "alice" });
  });
  it("refuses a bad signature", async () => {
    const res = await setup(true).post("/api/owners", { signed: { owner: "alice.testnet", action: "register_owner", bad: true } });
    expect(res.status).toBe(401);
  });
  it("records a signed heartbeat and starts watching the owner", async () => {
    const t = setup(false);
    const res = await t.post("/api/heartbeat", { signed: { owner: "alice.testnet", action: "heartbeat" } });
    expect(res.status).toBe(200);
    expect(t.store.get().heartbeats["alice.testnet"]).toBeDefined();
    expect(t.store.get().owners["alice.testnet"]).toEqual({ owner: "alice.testnet" });
  });
  it("never accepts an unsigned heartbeat, even in demo mode", async () => {
    expect((await setup(true).post("/api/heartbeat", { owner: "alice.testnet" })).status).toBe(401);
  });
  it("the heir guide answers only a signed request from an heir of the will", async () => {
    const ai = { heirGuide: async () => ({ ok: true, answer: "hello", ai: { model: "m" } }) } as unknown as ApiDeps["ai"];
    const t = setup(true, HASH, ai);
    const ask = (signer: string) => ({ signed: { owner: signer, action: "heir_guide", data: { owner: "alice.testnet", question: "hi" } } });
    expect((await t.post("/api/heir/guide", { owner: "alice.testnet", question: "hi" })).status).toBe(401);
    expect((await t.post("/api/heir/guide", ask("mallory.testnet"))).status).toBe(403);
    expect(await (await t.post("/api/heir/guide", ask("bola.testnet"))).json()).toMatchObject({ ok: true, answer: "hello" });
  });
  it("refuses a heartbeat for an owner with no will", async () => {
    expect((await setup(false).post("/api/heartbeat", { signed: { owner: "bob.testnet", action: "heartbeat" } })).status).toBe(404);
  });
});

describe("demo vault faucet", () => {
  function faucetSetup(balances: Record<string, bigint> = { Eth: 0n, Btc: 0n }, demoMode = true) {
    const sent: string[] = [];
    const faucet = {
      ethAddress: "0xpool",
      btcAddress: "tb1pool",
      amounts: { eth_wei: "1", btc_sats: 2 },
      send: async (chain: "Eth" | "Btc", to: string) => {
        sent.push(`${chain}:${to}`);
        return { chain, to, amount: "1", txHash: `h-${chain}` };
      },
    };
    const vaults = (["Eth", "Btc"] as const).map((chain) => ({
      chain,
      asset: chain === "Eth" ? "ETH" : "BTC",
      address: async (o: string) => `${chain}-vault-${o}`,
      balance: async () => balances[chain],
    })) as unknown as ApiDeps["vaults"];
    return { ...setup(demoMode, HASH, undefined, { faucet, vaults }), sent };
  }
  const signed = (owner = "alice.testnet") => ({ signed: { owner, action: "demo_faucet", data: {} } });

  it("funds each empty vault once, signed by the owner", async () => {
    const t = faucetSetup();
    const res = await t.post("/demo/faucet", signed());
    expect(await res.json()).toMatchObject({ ok: true, sends: [{ chain: "Eth" }, { chain: "Btc" }] });
    expect(t.sent).toEqual(["Eth:Eth-vault-alice.testnet", "Btc:Btc-vault-alice.testnet"]);
    expect((await t.post("/demo/faucet", signed())).status).toBe(409);
  });
  it("skips a vault that already holds coins", async () => {
    const t = faucetSetup({ Eth: 5n, Btc: 0n });
    await t.post("/demo/faucet", signed());
    expect(t.sent).toEqual(["Btc:Btc-vault-alice.testnet"]);
  });
  it("is off outside demo mode and needs a signature", async () => {
    expect((await faucetSetup(undefined, false).post("/demo/faucet", signed())).status).toBe(403);
    expect((await faucetSetup().post("/demo/faucet", { owner: "alice.testnet" })).status).toBe(401);
    expect(await (await faucetSetup(undefined, false).app.request("/demo/faucet")).json()).toEqual({ enabled: false });
  });
});
