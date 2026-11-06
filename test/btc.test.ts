import * as bitcoin from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { BtcVault, MAX_INPUTS } from "../src/chains/btc";
import type { StageJob } from "../src/executor/executor";
import type { WillContract } from "../src/near/will-contract";
import { Store } from "../src/state/store";

const VAULT = "tb1qjzz0h4l7j3m9x7w6y8ezlmdslr7zfy75zqj7zg";
const HEIR = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 7), network: bitcoin.networks.testnet }).address!;
const txid = (n: number) => n.toString(16).padStart(64, "0");

interface Utxo {
  txid: string;
  vout: number;
  value: number;
}

/** A fake mempool.space API: UTXO list, fees, broadcast and outspend lookups. */
function mempool(utxos: Utxo[], opts: { broadcast?: number; spent?: Record<string, string> } = {}) {
  const posted: string[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace("https://mp", "");
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === `/address/${VAULT}/utxo`) return json(utxos);
    if (path === "/v1/fees/recommended") return json({ halfHourFee: 2 });
    if (path === "/tx" && init?.method === "POST") {
      posted.push(init.body!);
      return new Response(opts.broadcast === undefined ? "txid" : "bad-txns-inputs-missingorspent", { status: opts.broadcast ?? 200 });
    }
    const out = path.match(/^\/tx\/(\w+)\/outspend\/(\d+)$/);
    if (out) {
      const by = opts.spent?.[`${out[1]}:${out[2]}`];
      return json(by ? { spent: true, txid: by } : { spent: false });
    }
    if (path.startsWith("/tx/")) return new Response("not found", { status: 404 });
    throw new Error(`unexpected ${path}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, posted };
}

/** A BtcVault with the MPC derivation and the PSBT building replaced by fakes (no network). */
function vault(utxos: Utxo[], opts: Parameters<typeof mempool>[1] & { failSignAt?: number[] } = {}) {
  const store = new Store(null);
  const mp = mempool(utxos, opts);
  let calls = 0;
  const signed: number[] = [];
  const contract = {
    async requestSignature() {
      calls++;
      if (opts.failSignAt?.includes(calls)) throw new Error("408 Timeout error");
      signed.push(calls);
      return { big_r: { affine_point: "02" + "1".repeat(64) }, s: { scalar: "2".repeat(64) }, recovery_id: 0 };
    },
  } as unknown as WillContract;
  const v = new BtcVault("inheirit.testnet", contract, store, "https://mp", mp.fetchImpl);
  const inner = v as unknown as { derived: Map<string, unknown>; btc: unknown };
  inner.derived.set("alice.testnet", { address: VAULT, publicKey: "02" + "3".repeat(64) });
  let built: { txid: string; vout: number }[] = [];
  inner.btc = {
    prepareTransactionForSigning: async ({ inputs, outputs }: { inputs: Utxo[]; outputs: { value: number }[] }) => {
      built = inputs;
      const tx = new bitcoin.Transaction();
      for (const i of inputs) tx.addInput(Buffer.from(i.txid, "hex"), i.vout);
      for (const o of outputs) tx.addOutput(bitcoin.address.toOutputScript(HEIR, bitcoin.networks.testnet), o.value);
      return { transaction: tx, hashesToSign: inputs.map(() => new Uint8Array(32)) };
    },
    finalizeTransactionSigning: ({ transaction }: { transaction: bitcoin.Transaction }) => transaction.toHex(),
  };
  return { v, store, mp, signed, calls: () => calls, built: () => built };
}

const job = (isLast: boolean, gross: bigint): StageJob => ({ owner: "alice.testnet", round: 1, stage: 3, isLast, gross, unpaidShares: { h1: 100 }, recipients: { h1: HEIR } });

describe("BtcVault under the contract's 16-signature cap", () => {
  it("the final sweep spends at most MAX_INPUTS UTXOs, the largest, even when someone sends the vault many tiny ones", async () => {
    const spam = Array.from({ length: 30 }, (_, i) => ({ txid: txid(100 + i), vout: 0, value: 600 }));
    const real = [50_000, 30_000, 20_000].map((value, i) => ({ txid: txid(i + 1), vout: 0, value }));
    const t = vault([...spam, ...real]);
    const sent = await t.v.sendStage(job(true, 100_000n));
    expect(t.signed.length).toBeLessThanOrEqual(MAX_INPUTS);
    expect(t.built().slice(0, 3).map((i) => i.txid)).toEqual(real.map((u) => u.txid));
    expect(sent[0].amount).toBe(100_000n - BigInt((11 + 68 * MAX_INPUTS + 31) * 2)); // gross less the fee at 2 sat/vB
  });

  it("skips UTXOs worth less than the fee to spend them", async () => {
    const t = vault([{ txid: txid(1), vout: 0, value: 40_000 }, { txid: txid(2), vout: 0, value: 100 }]);
    await t.v.sendStage(job(true, 40_100n));
    expect(t.built().map((i) => i.txid)).toEqual([txid(1)]);
  });

  it("keeps signatures already obtained when an MPC call times out, so the retry asks only for the rest", async () => {
    const utxos = [1, 2, 3, 4].map((n) => ({ txid: txid(n), vout: 0, value: 10_000 }));
    const t = vault(utxos, { failSignAt: [3] });
    await expect(t.v.sendStage(job(true, 40_000n))).rejects.toThrow("408");
    expect(t.store.get().btcSigning["alice.testnet:1:3:Btc"].sigs).toHaveLength(2);
    await t.v.sendStage(job(true, 40_000n));
    expect(t.calls()).toBe(5); // 4 inputs + 1 lost to the timeout, not 4 + 4
    expect(t.store.get().btcSigning["alice.testnet:1:3:Btc"]).toBeUndefined();
    expect(t.store.get().pendingTxs["alice.testnet:1:3:Btc"]).toBeDefined();
  });

  it("does not build on a UTXO that another tx already spent (mempool.space lists it for a while)", async () => {
    const t = vault([{ txid: txid(1), vout: 0, value: 30_000 }, { txid: txid(2), vout: 0, value: 20_000 }], { spent: { [`${txid(1)}:0`]: txid(99) } });
    await t.v.sendStage(job(true, 50_000n));
    expect(t.built().map((i) => i.txid)).toEqual([txid(2)]);
  });

  it("drops a pending tx whose input another tx spent, so the stage is planned again instead of failing forever", async () => {
    const t = vault([{ txid: txid(1), vout: 0, value: 30_000 }], { broadcast: 400 });
    await expect(t.v.sendStage(job(true, 30_000n))).rejects.toThrow("broadcast failed");
    expect(t.store.get().pendingTxs["alice.testnet:1:3:Btc"]).toBeDefined(); // not spent elsewhere: keep it
    const withSpent = vault([], { broadcast: 400, spent: { [`${txid(1)}:0`]: txid(77) } });
    withSpent.store.update((s) => (s.pendingTxs["alice.testnet:1:3:Btc"] = { raw: "00", hash: txid(50), pays: {}, inputs: [{ txid: txid(1), vout: 0 }] }));
    await expect(withSpent.v.sendStage(job(true, 30_000n))).rejects.toThrow("is dead");
    expect(withSpent.store.get().pendingTxs["alice.testnet:1:3:Btc"]).toBeUndefined();
  });

  it("sends an owner's withdrawal of the exact amount with change back to the vault", async () => {
    const t = vault([{ txid: txid(1), vout: 0, value: 50_000 }]);
    const hash = await t.v.sendWithdrawal("alice.testnet", { id: 2, to: HEIR, amount: "20000" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.signed).toHaveLength(1);
    const pending = t.store.get().pendingTxs["alice.testnet:w2:Btc"];
    expect(pending.pays).toEqual({ owner: [HEIR, "20000"] });
    await expect(t.v.sendWithdrawal("alice.testnet", { id: 3, to: HEIR, amount: "100" })).rejects.toThrow("below dust");
  });
});
