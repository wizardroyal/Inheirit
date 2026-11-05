import * as bitcoinjs from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { DemoFaucet } from "../src/demo/faucet";

const TXID_A = "aa".repeat(32);
const TXID_B = "bb".repeat(32);

// A fake mempool.space API whose UTXO list still shows `stale` after it was spent
function fakeMempool(stale: string) {
  const broadcasts: string[][] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/utxo"))
      return Response.json([
        { txid: TXID_A, vout: 0, value: 100_000 },
        { txid: TXID_B, vout: 1, value: 60_000 },
      ]);
    if (url.endsWith("/fees/recommended")) return Response.json({ halfHourFee: 1 });
    if (url.endsWith("/tx") && init?.method === "POST") {
      const tx = bitcoinjs.Transaction.fromHex(String(init.body));
      const ins = tx.ins.map((i) => Buffer.from(i.hash).reverse().toString("hex"));
      broadcasts.push(ins);
      if (ins.includes(stale)) return new Response('sendrawtransaction RPC error: {"code":-25,"message":"bad-txns-inputs-missingorspent"}', { status: 400 });
      return new Response(tx.getId());
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { fetchImpl, broadcasts };
}

const faucet = (fetchImpl: typeof fetch) =>
  new DemoFaucet(
    { ethPrivateKey: `0x${"11".repeat(32)}`, btcPrivateKeyHex: "22".repeat(32), sepoliaRpc: "http://unused", btcApi: "https://mempool.test/api", ethWei: 1n, btcSats: 20_000 },
    fetchImpl,
  );

describe("DemoFaucet BTC", () => {
  it("retries once with another UTXO when the listed one was already spent", async () => {
    const m = fakeMempool(TXID_A);
    const f = faucet(m.fetchImpl);
    const send = await f.send("Btc", "tb1qjzz0h4l7j3m9x7w6y8ezlmdslr7zfy75zqj7zg");
    expect(send).toMatchObject({ chain: "Btc", amount: "20000" });
    expect(m.broadcasts).toEqual([[TXID_A], [TXID_B]]);
  });

  it("never reuses an outpoint it spent, even if the API still lists it", async () => {
    const m = fakeMempool("none");
    const f = faucet(m.fetchImpl);
    await f.send("Btc", "tb1qjzz0h4l7j3m9x7w6y8ezlmdslr7zfy75zqj7zg");
    await f.send("Btc", "tb1qjzz0h4l7j3m9x7w6y8ezlmdslr7zfy75zqj7zg");
    expect(m.broadcasts).toEqual([[TXID_A], [TXID_B]]);
  });
});
