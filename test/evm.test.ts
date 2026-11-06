import { describe, expect, it } from "vitest";
import { keccak256, serializeTransaction, type Hex } from "viem";
import { EvmVault } from "../src/chains/evm";
import type { StageJob } from "../src/executor/executor";
import type { WillContract } from "../src/near/will-contract";
import { Store } from "../src/state/store";

const FROM = ("0x" + "a".repeat(40)) as Hex;
const H1 = ("0x" + "1".repeat(40)) as Hex;
const H2 = ("0x" + "2".repeat(40)) as Hex;
const KEY = "alice.testnet:1:0:Eth:h1";

const rawAt = (nonce: number) => serializeTransaction({ chainId: 11155111, type: "eip1559", nonce, to: H1, value: 1n, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });

/** An EvmVault with viem and the MPC calls replaced by fakes. */
function vault(opts: { pendingCount?: number; minedCount?: number; known?: boolean; receipt?: "timeout" | "success" } = {}) {
  const store = new Store(null);
  const nonces: number[] = [];
  const client = {
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    estimateGas: async () => 21000n,
    getBalance: async () => 10n ** 18n,
    getTransactionCount: async ({ blockTag }: { blockTag: string }) => (blockTag === "pending" ? (opts.pendingCount ?? 5) : (opts.minedCount ?? 5)),
    sendRawTransaction: async () => "0x",
    getTransaction: async () => (opts.known ? {} : Promise.reject(new Error("not found"))),
    waitForTransactionReceipt: async () => {
      if (opts.receipt === "timeout") throw new Error("Timed out while waiting for transaction");
      return { status: "success", gasUsed: 21000n };
    },
  };
  const evm = {
    prepareTransactionForSigning: async (tx: { nonce: number }) => {
      nonces.push(tx.nonce);
      return { transaction: tx, hashesToSign: [new Uint8Array(32)] };
    },
    finalizeTransactionSigning: ({ transaction }: { transaction: { nonce: number } }) => rawAt(transaction.nonce),
  };
  const contract = { requestSignature: async () => ({ big_r: { affine_point: "02" + "1".repeat(64) }, s: { scalar: "2".repeat(64) }, recovery_id: 0 }) } as unknown as WillContract;
  const v = new EvmVault("inheirit.testnet", contract, store, "http://localhost:1");
  const inner = v as unknown as { client: unknown; evm: unknown; addresses: Map<string, Hex> };
  inner.client = client;
  inner.evm = evm;
  inner.addresses.set("alice.testnet", FROM);
  return { v, store, nonces };
}

const job: StageJob = { owner: "alice.testnet", round: 1, stage: 0, isLast: false, gross: 10n ** 16n, unpaidShares: { h1: 50, h2: 50 }, recipients: { h1: H1, h2: H2 } };

describe("EvmVault idempotency", () => {
  it("gives a stage's heirs consecutive nonces even if the RPC's pending count is stale", async () => {
    const t = vault({ pendingCount: 5 }); // the count never moves, as from a lagging node
    await t.v.sendStage(job);
    expect(t.nonces).toEqual([5, 6]);
  });

  it("drops a pending tx whose nonce another tx used, but only after it looked dead on two checks", async () => {
    const t = vault({ minedCount: 9, known: false, receipt: "timeout" });
    t.store.update((s) => (s.pendingTxs[KEY] = { raw: rawAt(7), hash: keccak256(rawAt(7)), pays: { h1: [H1, "1"] } }));
    await expect(t.v.sendStage({ ...job, unpaidShares: { h1: 100 } })).rejects.toThrow("Timed out");
    expect(t.store.get().pendingTxs[KEY].deadSince).toBeDefined(); // first sighting: kept
    t.store.update((s) => (s.pendingTxs[KEY].deadSince = new Date(Date.now() - 200_000).toISOString()));
    await expect(t.v.sendStage({ ...job, unpaidShares: { h1: 100 } })).rejects.toThrow("can never land");
    expect(t.store.get().pendingTxs[KEY]).toBeUndefined();
  });

  it("keeps waiting on a slow tx that is still known or whose nonce is not used yet", async () => {
    for (const o of [{ known: true, minedCount: 9 }, { known: false, minedCount: 7 }]) {
      const t = vault({ ...o, receipt: "timeout" });
      t.store.update((s) => (s.pendingTxs[KEY] = { raw: rawAt(7), hash: keccak256(rawAt(7)), pays: { h1: [H1, "1"] }, deadSince: new Date(0).toISOString() }));
      await expect(t.v.sendStage({ ...job, unpaidShares: { h1: 100 } })).rejects.toThrow("Timed out");
      expect(t.store.get().pendingTxs[KEY]).toBeDefined();
      expect(t.store.get().pendingTxs[KEY].deadSince).toBeUndefined();
    }
  });

  it("sends an owner's withdrawal with the Withdrawal purpose, and only rebroadcasts it after", async () => {
    const t = vault();
    const purposes: unknown[] = [];
    (t.v as unknown as { contract: { requestSignature: (...a: unknown[]) => Promise<unknown> } }).contract = {
      requestSignature: async (...a: unknown[]) => (purposes.push(a[3]), { big_r: { affine_point: "02" + "1".repeat(64) }, s: { scalar: "2".repeat(64) }, recovery_id: 0 }),
    };
    const w = { id: 7, to: H2, amount: "1000" };
    const hash = await t.v.sendWithdrawal("alice.testnet", w);
    expect(await t.v.sendWithdrawal("alice.testnet", w)).toBe(hash);
    expect(purposes).toEqual([{ Withdrawal: { id: 7 } }]);
    await expect(t.v.sendWithdrawal("alice.testnet", { id: 8, to: "bob.testnet", amount: "1" })).rejects.toThrow("not an EVM address");
  });
});
