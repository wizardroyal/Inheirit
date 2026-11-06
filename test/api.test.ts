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
    getWill: async (owner: string) => (owner === "alice.testnet" ? ({ owner, policy_hash: onChainHash, state: "Active", heirs: [{ account_id: "bola.testnet" }], guardians: [], guardian_threshold: 1, last_alive_at: 0, foreign_chains: ["Eth", "Btc"] } as unknown as WillView) : null),
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
  const sim = (data: Record<string, string>, owner = "alice.testnet") => ({ signed: { owner, action: "demo_signal", data } });
  it("simulated signals are refused outside demo mode", async () => {
    expect((await setup(false).post("/demo/signal", sim({ source: "x" }))).status).toBe(403);
  });
  it("records a SIMULATED signal in demo mode, signed by the owner", async () => {
    const t = setup(true);
    const res = await t.post("/demo/signal", sim({ source: "x", at: "2026-11-01T00:00:00Z" }));
    expect(await res.json()).toMatchObject({ ok: true, simulated: true });
    expect(t.store.get().simulated["alice.testnet"]).toEqual({ x: "2026-11-01T00:00:00Z" });
  });
  it("an unsigned simulated signal is refused, so strangers can't keep a will alive", async () => {
    const t = setup(true);
    expect((await t.post("/demo/signal", { owner: "alice.testnet", source: "gmail" })).status).toBe(401);
    expect(t.store.get().simulated["alice.testnet"]).toBeUndefined();
  });
  it("only simulated sources can be written", async () => {
    expect((await setup(true).post("/demo/signal", sim({ source: "near_onchain" }))).status).toBe(400);
  });
  it("owner registration is never unsigned, even in demo mode (a stranger's busy EVM address would keep the will alive)", async () => {
    expect((await setup(false).post("/api/owners", { owner: "alice.testnet" })).status).toBe(401);
    const t = setup(true);
    expect((await t.post("/api/owners", { owner: "alice.testnet", evm_address: "0x" + "b".repeat(40) })).status).toBe(401);
    expect(t.store.get().owners["alice.testnet"]).toBeUndefined();
  });
});

describe("owner-signed routes", () => {
  it("registers signal identities from a signed request outside demo mode", async () => {
    const t = setup(false);
    const res = await t.post("/api/owners", { signed: { owner: "alice.testnet", action: "register_owner", data: { github: "alice" } } });
    expect(await res.json()).toMatchObject({ ok: true, signed: true });
    expect(t.store.get().owners["alice.testnet"]).toMatchObject({ owner: "alice.testnet", github: "alice", watchedSince: expect.any(String) });
  });
  it("refuses the will's own vault or an heir's receive address as the owner's EVM address", async () => {
    const vault = "0x" + "c".repeat(40);
    const heirEth = "0x" + "d".repeat(40);
    const vaults = [{ chain: "Eth", address: async () => vault, balance: async () => 0n }] as unknown as ApiDeps["vaults"];
    const t = setup(false, HASH, undefined, { vaults });
    t.store.update((s) => (s.policies["alice.testnet"] = { ...parsed.policy, heirs: [{ ...parsed.policy.heirs[0], receive: { eth: heirEth } }] }));
    const reg = (evm_address: string) => t.post("/api/owners", { signed: { owner: "alice.testnet", action: "register_owner", data: { evm_address } } });
    expect((await reg(vault.toUpperCase().replace("0X", "0x"))).status).toBe(400);
    expect((await reg(heirEth)).status).toBe(400);
    expect((await reg("0x" + "e".repeat(40))).status).toBe(200);
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
    expect(t.store.get().owners["alice.testnet"]).toMatchObject({ owner: "alice.testnet", watchedSince: expect.any(String) });
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
  function faucetSetup(balances: Record<string, bigint> = { Eth: 0n, Btc: 0n }, demoMode = true, failing = new Set<string>()) {
    const sent: string[] = [];
    const faucet = {
      ethAddress: "0xpool",
      btcAddress: "tb1pool",
      amounts: { eth_wei: "1", btc_sats: 2 },
      send: async (chain: "Eth" | "Btc", to: string) => {
        if (failing.has(chain)) throw new Error("mempool UTXO fetch 503");
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
  it("lets a chain whose send failed be retried, without re-funding the others", async () => {
    const failing = new Set(["Btc"]);
    const t = faucetSetup(undefined, true, failing);
    const first = await t.post("/demo/faucet", signed());
    expect(await first.json()).toMatchObject({ ok: false, sends: [{ chain: "Eth" }], errors: ["Btc: mempool UTXO fetch 503"] });
    failing.clear();
    const retry = await t.post("/demo/faucet", signed());
    expect(await retry.json()).toMatchObject({ ok: true, sends: [{ chain: "Btc" }] });
    expect(t.sent).toEqual(["Eth:Eth-vault-alice.testnet", "Btc:Btc-vault-alice.testnet"]);
    expect((await t.post("/demo/faucet", signed())).status).toBe(409);
  });
  it("is off outside demo mode and needs a signature", async () => {
    expect((await faucetSetup(undefined, false).post("/demo/faucet", signed())).status).toBe(403);
    expect((await faucetSetup().post("/demo/faucet", { owner: "alice.testnet" })).status).toBe(401);
    expect(await (await faucetSetup(undefined, false).app.request("/demo/faucet")).json()).toEqual({ enabled: false });
  });
});

describe("GET /api/overview/:owner", () => {
  it("returns status, signals with the verdict, this owner's notifications and Telegram status in one response", async () => {
    const t = setup(true);
    const note = { at: "2026-11-05T00:00:00Z", event: "Quiet", to: ["x"], channels: ["ui"], subject: "s", body: "b" };
    t.store.update((s) => {
      s.notifications.push({ ...note, owner: "alice.testnet" }, { ...note, owner: "carol.testnet" });
      s.observations["alice.testnet"] = { near_onchain: { at: "2026-11-05T00:00:00Z", trustWeight: 0.9, simulated: false } };
    });
    const body = await (await t.app.request("/api/overview/alice.testnet")).json();
    expect(body.status.state).toBe("Active");
    expect(body.signals.observations.near_onchain).toBeDefined();
    expect(body.signals.verdict.headline).toMatch(/^Alive\./);
    expect(body.notifications.map((n: { owner: string }) => n.owner)).toEqual(["alice.testnet"]);
    expect(body.telegram).toEqual({ enabled: false, linked: false });
  });
  it("masks notification recipients: emails shortened, heirs hidden before release, no list of every owner", async () => {
    const t = setup(true);
    t.store.update((s) =>
      s.notifications.push({ at: "2026-11-05T00:00:00Z", owner: "alice.testnet", event: "Executing", to: ["bola.testnet", "friend@example.com", "g1.testnet"], channels: ["ui"], subject: "s", body: "b" }),
    );
    const notes = await (await t.app.request("/api/notifications?owner=alice.testnet")).json();
    expect(notes[0].to).toEqual(["an heir", "f…@example.com", "g1.testnet"]);
    const overview = await (await t.app.request("/api/overview/alice.testnet")).text();
    expect(overview).not.toMatch(/bola\.testnet|friend@/);
    expect((await t.app.request("/api/notifications")).status).toBe(400);
  });
  it("reports which sources are watched as flags, never the owner's addresses or handles", async () => {
    const t = setup(true);
    t.store.update((s) => (s.owners["alice.testnet"] = { owner: "alice.testnet", email: "alice@example.com", evmAddress: "0x" + "a".repeat(40), github: "alice-gh" }));
    const text = await (await t.app.request("/api/overview/alice.testnet")).text();
    expect(text).not.toMatch(/alice@example\.com|aaaaaaaa|alice-gh/);
    expect(JSON.parse(text).status.watching).toMatchObject({ evm: true, github: true, email: true });
    expect(await (await t.app.request("/api/status/alice.testnet")).text()).not.toMatch(/alice@example\.com/);
  });
  it("still answers for an owner without a will", async () => {
    const body = await (await setup(true).app.request("/api/overview/nobody.testnet")).json();
    expect(body.status).toBeNull();
    expect(body.signals.verdict).toBeNull();
  });
});
