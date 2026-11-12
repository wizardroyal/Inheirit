import { describe, expect, it } from "vitest";
import { EvmNonceAdapter, GithubAdapter, NearOnchainAdapter, SimulatedAdapter } from "../src/signals/adapters";
import { Store } from "../src/state/store";

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const owner = { owner: "alice.testnet", evmAddress: "0x" + "1".repeat(40), github: "alice" };

describe("NearOnchainAdapter", () => {
  it("returns the newest tx the owner signed", async () => {
    const a = new NearOnchainAdapter("http://x", json({
      account_txs: [
        { is_any_signer: true, tx_block_timestamp: "1793140445188970213" },
        { is_any_signer: false, tx_block_timestamp: "1793140999000000000" },
        { is_any_signer: true, tx_block_timestamp: "1793140000000000000" },
      ],
    }));
    expect(await a.lastActivity(owner)).toEqual(new Date(1793140445188));
  });
  it("returns null when the owner signed nothing", async () => {
    expect(await new NearOnchainAdapter("http://x", json({ account_txs: [] })).lastActivity(owner)).toBeNull();
  });
  it("throws on API errors instead of reporting silence", async () => {
    await expect(new NearOnchainAdapter("http://x", json({}, 500)).lastActivity(owner)).rejects.toThrow();
  });
});

describe("NearOnchainAdapter with extra accounts", () => {
  it("takes the latest across accounts, reads *.near from mainnet, and survives one failing", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const account = JSON.parse(String(init.body)).account_id;
      seen.push(`${url} ${account}`);
      if (account === "broken.testnet") return new Response("down", { status: 503 });
      const ts = account === "alice.near" ? "1793140999000000000" : "1793140000000000000";
      return new Response(JSON.stringify({ account_txs: [{ is_any_signer: true, tx_block_timestamp: ts }] }));
    }) as unknown as typeof fetch;
    const a = new NearOnchainAdapter("http://test", fetchImpl, "http://main");
    const at = await a.lastActivity({ owner: "alice.testnet", nearAccounts: ["alice.near", "broken.testnet"] });
    expect(at).toEqual(new Date(1793140999000));
    expect(seen).toContain("http://main/v0/account alice.near");
    expect(seen).toContain("http://test/v0/account alice.testnet");
  });
});

describe("EvmNonceAdapter", () => {
  it("records the first nonce, then reports activity when it rises", async () => {
    const store = new Store(null);
    let nonce = 5;
    const fetchImpl = (async () => new Response(JSON.stringify({ result: "0x" + nonce.toString(16) }))) as unknown as typeof fetch;
    const t = new Date("2026-11-01T00:00:00Z");
    const a = new EvmNonceAdapter("http://rpc", store, fetchImpl, () => t);
    expect(await a.lastActivity(owner)).toBeNull();
    expect(await a.lastActivity(owner)).toBeNull();
    nonce = 6;
    expect(await a.lastActivity(owner)).toEqual(t);
    expect(store.get().evmNonces["alice.testnet"]).toEqual({ nonce: 6, seenAt: t.toISOString() });
  });
  it("watches every address the owner gave, each with its own nonce record", async () => {
    const store = new Store(null);
    const nonces: Record<string, number> = { ["0x" + "1".repeat(40)]: 5, ["0x" + "2".repeat(40)]: 9 };
    const fetchImpl = (async (_: string, init: RequestInit) => {
      const addr = JSON.parse(String(init.body)).params[0];
      return new Response(JSON.stringify({ result: "0x" + nonces[addr].toString(16) }));
    }) as unknown as typeof fetch;
    const t = new Date("2026-11-02T00:00:00Z");
    const a = new EvmNonceAdapter("http://rpc", store, fetchImpl, () => t);
    const cfg = { owner: "alice.testnet", evmAddress: "0x" + "1".repeat(40), evmAddresses: ["0x" + "2".repeat(40)] };
    expect(await a.lastActivity(cfg)).toBeNull();
    nonces["0x" + "2".repeat(40)] = 10; // only the second address moves
    expect(await a.lastActivity(cfg)).toEqual(t);
    expect(store.get().evmNonces[`alice.testnet|${"0x" + "2".repeat(40)}`]).toEqual({ nonce: 10, seenAt: t.toISOString() });
  });
  it("is skipped without an address", async () => {
    const a = new EvmNonceAdapter("http://rpc", new Store(null), json({}));
    expect(await a.lastActivity({ owner: "bob.testnet" })).toBeNull();
  });
});

describe("GithubAdapter", () => {
  it("returns the latest public event time", async () => {
    const a = new GithubAdapter(undefined, json([{ created_at: "2026-10-30T10:00:00Z" }]));
    expect(await a.lastActivity(owner)).toEqual(new Date("2026-10-30T10:00:00Z"));
  });
});

describe("SimulatedAdapter", () => {
  it("is flagged simulated and reads the demo store", async () => {
    const store = new Store(null);
    store.update((s) => (s.simulated["alice.testnet"] = { x: "2026-11-01T01:00:00Z" }));
    const a = new SimulatedAdapter("x", 0.4, store);
    expect(a.simulated).toBe(true);
    expect(await a.lastActivity(owner)).toEqual(new Date("2026-11-01T01:00:00Z"));
    expect(await new SimulatedAdapter("instagram", 0.4, store).lastActivity(owner)).toBeNull();
  });
});
