// BTC vault on testnet4: a P2WPKH address derived by the MPC network from (contract, vault path).
// One tx per stage with an output per heir and change back to the vault; one MPC signature per
// input (about a minute each), so keep vaults to a few UTXOs.
import * as bitcoin from "bitcoinjs-lib";
import { chainAdapters, contracts, utils, type MPCSignature } from "chainsig.js";
import coinSelect from "coinselect";
import { stageTargets } from "../executor/amounts";
import type { ChainVault, SentTransfer, StageJob } from "../executor/executor";
import type { WillContract } from "../near/will-contract";
import type { Store } from "../state/store";
import type { Fetch } from "../signals/adapters";
import { MPC_CONTRACT_ID, vaultPath } from "./vault-path";

const { toRSV, uint8ArrayToHex } = utils.cryptography;
const DUST_SATS = 546;
// P2WPKH virtual sizes: overhead, per input, per output.
const VB_OVERHEAD = 11;
const VB_INPUT = 68;
const VB_OUTPUT = 31;

interface Utxo {
  txid: string;
  vout: number;
  value: number;
}

export class BtcVault implements ChainVault {
  readonly chain = "Btc" as const;
  readonly asset = "BTC" as const;
  private readonly btc;
  private readonly derived = new Map<string, { address: string; publicKey: string }>();

  constructor(
    private readonly contractId: string,
    private readonly contract: WillContract,
    private readonly store: Store,
    private readonly api: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    const mpc = new contracts.ChainSignatureContract({ networkId: "testnet", contractId: MPC_CONTRACT_ID });
    this.btc = new chainAdapters.btc.Bitcoin({
      network: "testnet",
      contract: mpc,
      btcRpcAdapter: new chainAdapters.btc.BTCRpcAdapters.Mempool(api),
    });
  }

  private async derive(owner: string) {
    let d = this.derived.get(owner);
    if (!d) {
      d = await this.btc.deriveAddressAndPublicKey(this.contractId, vaultPath(owner, "Btc"));
      this.derived.set(owner, d);
    }
    return d;
  }

  async address(owner: string): Promise<string> {
    return (await this.derive(owner)).address;
  }

  /** Spendable balance, unconfirmed included (chainsig's getBalance counts confirmed only). */
  async balance(owner: string): Promise<bigint> {
    const utxos = await this.utxos(await this.address(owner));
    return BigInt(utxos.reduce((s, u) => s + u.value, 0));
  }

  /** Fetched directly: chainsig's Mempool.fetchUTXOs turns network errors into "no UTXOs". */
  private async utxos(address: string): Promise<Utxo[]> {
    const res = await this.fetchImpl(`${this.api}/address/${address}/utxo`);
    if (!res.ok) throw new Error(`mempool UTXO fetch ${res.status}`);
    return (await res.json()) as Utxo[];
  }

  private async feeRate(): Promise<number> {
    const res = await this.fetchImpl(`${this.api}/v1/fees/recommended`);
    if (!res.ok) throw new Error(`mempool fee fetch ${res.status}`);
    const fees = (await res.json()) as { halfHourFee: number };
    return Math.max(1, Math.ceil(fees.halfHourFee));
  }

  async sendStage(job: StageJob): Promise<SentTransfer[]> {
    const key = `${job.owner}:${job.round}:${job.stage}:Btc`;
    let pending = this.store.get().pendingTxs[key];
    if (!pending) {
      const { address, publicKey } = await this.derive(job.owner);
      const script = bitcoin.address.toOutputScript(address, bitcoin.networks.testnet);
      const utxos = await this.utxos(address);
      const rate = await this.feeRate();
      let inputs: Utxo[];
      let outputs: { address: string; value: number }[];
      let targets: Map<string, bigint>;

      if (job.isLast) {
        // Sweep: every UTXO in, one output per heir, no change.
        inputs = utxos;
        const nOut = Object.keys(job.unpaidShares).length;
        const fee = BigInt(Math.ceil((VB_OVERHEAD + VB_INPUT * inputs.length + VB_OUTPUT * nOut) * rate));
        targets = stageTargets(job, fee);
        outputs = [...targets].map(([id, v]) => ({ address: job.recipients[id], value: Number(v) }));
      } else {
        targets = stageTargets(job, 0n);
        const sel = coinSelect(
          utxos.map((u) => ({ txId: u.txid, vout: u.vout, value: u.value, script })),
          [...targets].map(([id, v]) => ({ address: job.recipients[id], value: Number(v) })),
          rate,
        );
        if (!sel.inputs || !sel.outputs) throw new Error(`vault ${address} cannot cover stage ${job.stage} plus fees`);
        inputs = sel.inputs.map((i) => ({ txid: i.txId, vout: i.vout, value: i.value }));
        outputs = sel.outputs.map((o) => ({ address: o.address ?? address, value: o.value! })); // no address = change
      }
      for (const o of outputs) {
        if (o.value < DUST_SATS) throw new Error(`output of ${o.value} sats to ${o.address} is below dust`);
      }

      const { transaction, hashesToSign } = await this.btc.prepareTransactionForSigning({
        publicKey,
        inputs: inputs.map((i) => ({ txid: i.txid, vout: i.vout, value: i.value, scriptPubKey: script })),
        outputs,
      });
      const signatures = [];
      for (const h of hashesToSign) {
        // Sequential: each MPC sign takes ~1 min and shares the agent's NEAR access keys.
        const sig = await this.contract.requestSignature(job.owner, "Btc", uint8ArrayToHex(h), { Release: { stage: job.stage } });
        signatures.push(toRSV(sig as MPCSignature));
      }
      const raw = this.btc.finalizeTransactionSigning({ transaction, rsvSignatures: signatures });
      const hash = bitcoin.Transaction.fromHex(raw).getId();
      pending = {
        raw,
        hash,
        pays: Object.fromEntries([...targets].map(([id, v]) => [id, [job.recipients[id], v.toString()]])),
      };
      const saved = pending;
      this.store.update((s) => (s.pendingTxs[key] = saved));
    }

    await this.broadcast(pending.raw, pending.hash);
    return Object.entries(pending.pays).map(([heirId, [to, amount]]) => ({ heirId, to, amount: BigInt(amount), txHash: pending!.hash }));
  }

  private async broadcast(raw: string, txid: string) {
    const res = await this.fetchImpl(`${this.api}/tx`, { method: "POST", body: raw });
    if (res.ok) return;
    // Already broadcast (mempool or mined) is fine; anything else is an error.
    const known = await this.fetchImpl(`${this.api}/tx/${txid}`);
    if (!known.ok) throw new Error(`BTC broadcast failed: ${res.status} ${await res.text()}`);
  }
}
