// Demo vault faucet (demo mode only). Tops up a new demo will's Sepolia and BTC testnet4 vaults from
// a small pool of test coins, so judges can watch a cross-chain release without coins of their own.
// The pool's addresses are also the demo heir's receive addresses, so released coins flow back to it.
// Testnet only; the pool keys come from the agent's (encrypted, in the TEE) environment.
import { secp256k1 } from "@noble/curves/secp256k1";
import * as bitcoinjs from "bitcoinjs-lib";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export interface FaucetConfig {
  ethPrivateKey: Hex;
  btcPrivateKeyHex: string;
  sepoliaRpc: string;
  btcApi: string;
  ethWei: bigint;
  btcSats: number;
}

export interface FaucetSend {
  chain: "Eth" | "Btc";
  to: string;
  amount: string;
  txHash: string;
}

const BTC_DUST = 546;

export class DemoFaucet {
  readonly ethAddress: `0x${string}`;
  readonly btcAddress: string;
  private readonly btcPub: Buffer;
  private queue: Promise<unknown> = Promise.resolve();
  /** Outpoints this faucet already spent: mempool.space can keep listing them for a while after a broadcast. */
  private readonly spent = new Set<string>();

  constructor(
    private readonly cfg: FaucetConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.ethAddress = privateKeyToAccount(cfg.ethPrivateKey).address;
    this.btcPub = Buffer.from(secp256k1.getPublicKey(Buffer.from(cfg.btcPrivateKeyHex, "hex"), true));
    this.btcAddress = bitcoinjs.payments.p2wpkh({ pubkey: this.btcPub, network: bitcoinjs.networks.testnet }).address!;
  }

  /** Sends are serialized: one pool key, so concurrent sends would race on nonces and UTXOs. */
  send(chain: "Eth" | "Btc", to: string): Promise<FaucetSend> {
    const run = () => (chain === "Eth" ? this.sendEth(to) : this.sendBtcRetrying(to));
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async sendEth(to: string): Promise<FaucetSend> {
    const account = privateKeyToAccount(this.cfg.ethPrivateKey);
    const transport = http(this.cfg.sepoliaRpc);
    const wallet = createWalletClient({ account, chain: sepolia, transport });
    const publicClient = createPublicClient({ chain: sepolia, transport });
    const hash = await wallet.sendTransaction({ to: to as `0x${string}`, value: this.cfg.ethWei });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`faucet ETH tx ${hash} reverted`);
    return { chain: "Eth", to, amount: this.cfg.ethWei.toString(), txHash: hash };
  }

  /** One retry when the node says an input is already spent (the UTXO list lagged behind a broadcast). */
  private async sendBtcRetrying(to: string): Promise<FaucetSend> {
    try {
      return await this.sendBtc(to);
    } catch (e) {
      if (!(e instanceof Error) || !/missingorspent/.test(e.message)) throw e;
      return this.sendBtc(to);
    }
  }

  private async sendBtc(to: string): Promise<FaucetSend> {
    const api = this.cfg.btcApi;
    const network = bitcoinjs.networks.testnet;
    const pay = bitcoinjs.payments.p2wpkh({ pubkey: this.btcPub, network });
    const utxoRes = await this.fetchImpl(`${api}/address/${this.btcAddress}/utxo`);
    if (!utxoRes.ok) throw new Error(`mempool UTXO fetch ${utxoRes.status}`);
    const utxos = ((await utxoRes.json()) as { txid: string; vout: number; value: number }[])
      .filter((u) => !this.spent.has(`${u.txid}:${u.vout}`))
      .sort((a, b) => b.value - a.value);
    const feeRes = await this.fetchImpl(`${api}/v1/fees/recommended`);
    if (!feeRes.ok) throw new Error(`mempool fee fetch ${feeRes.status}`);
    const rate = Math.max(1, Math.ceil(((await feeRes.json()) as { halfHourFee: number }).halfHourFee));

    const sats = this.cfg.btcSats;
    const psbt = new bitcoinjs.Psbt({ network });
    let total = 0;
    for (const u of utxos) {
      psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: pay.output!, value: u.value } });
      total += u.value;
      if (total >= sats + 2000) break;
    }
    // P2WPKH sizes in vbytes: ~11 overhead, ~68 per input, ~31 per output
    const fee = Math.ceil((11 + 68 * psbt.inputCount + 31 * 2) * rate);
    const change = total - sats - fee;
    if (change < 0) throw new Error(`faucet pool has ${total} sats, needs ${sats + fee}`);
    psbt.addOutput({ address: to, value: sats });
    if (change >= BTC_DUST) psbt.addOutput({ address: this.btcAddress, value: change });
    const priv = Buffer.from(this.cfg.btcPrivateKeyHex, "hex");
    psbt.signAllInputs({
      publicKey: this.btcPub,
      sign: (hash: Buffer) => Buffer.from(secp256k1.sign(hash, priv, { lowS: true }).toCompactRawBytes()),
    });
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    const inputs = psbt.txInputs.map((i) => `${Buffer.from(i.hash).reverse().toString("hex")}:${i.index}`);
    const res = await this.fetchImpl(`${api}/tx`, { method: "POST", body: tx.toHex() });
    const text = res.ok ? "" : await res.text();
    // A spent input stays spent whatever the cause, so skip it next time either way
    if (res.ok || /missingorspent/.test(text)) for (const i of inputs) this.spent.add(i);
    if (!res.ok) throw new Error(`BTC broadcast ${res.status}: ${text}`);
    return { chain: "Btc", to, amount: String(sats), txHash: tx.getId() };
  }
}
