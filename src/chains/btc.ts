// BTC vault on testnet4: a P2WPKH address derived by the MPC network from (contract, vault path).
// One tx per stage with an output per heir and change back to the vault; one MPC signature per
// input (about a minute each). The contract allows 16 signatures per (stage, chain), so a tx spends
// at most MAX_INPUTS UTXOs (the largest, skipping any worth less than its own spend fee): anyone can
// send many tiny UTXOs to a public vault, and that must not make the last stage unsignable.
import * as bitcoin from "bitcoinjs-lib";
import { chainAdapters, contracts, utils, type MPCSignature } from "chainsig.js";
import coinSelect from "coinselect";
import { dustSafeTargets } from "../executor/amounts";
import type { ChainVault, SentTransfer, StageJob } from "../executor/executor";
import type { SignPurpose, WillContract } from "../near/will-contract";
import type { BtcSigning, PendingTx, Store } from "../state/store";
import type { Fetch } from "../signals/adapters";
import { MPC_CONTRACT_ID, vaultPath } from "./vault-path";

const { toRSV, uint8ArrayToHex } = utils.cryptography;
const DUST_SATS = 546;
// P2WPKH virtual sizes: overhead, per input, per output.
const VB_OVERHEAD = 11;
const VB_INPUT = 68;
const VB_OUTPUT = 31;
/** Leaves room under the contract's 16 signatures per (stage, chain) for signatures lost to timeouts. */
export const MAX_INPUTS = 8;

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
    // null: nothing above dust to send (deferred to the final sweep, or only dust left)
    const tx = await this.signAndBroadcast(key, job.owner, { Release: { stage: job.stage } }, (address, script) => this.plan(job, address, script));
    if (!tx) return [];
    return Object.entries(tx.pays).map(([heirId, [to, amount]]) => ({ heirId, to, amount: BigInt(amount), txHash: tx.hash }));
  }

  /** An owner's withdrawal from the vault while the will is Active (§5.2): exact amount, change back. */
  async sendWithdrawal(owner: string, w: { id: number; to: string; amount: string }): Promise<string> {
    const tx = await this.signAndBroadcast(`${owner}:w${w.id}:Btc`, owner, { Withdrawal: { id: w.id } }, async (address, script) => {
      const value = Number(w.amount);
      if (!Number.isSafeInteger(value) || value < DUST_SATS) throw new Error(`withdrawal ${w.id}: ${w.amount} sats is below dust`);
      bitcoin.address.toOutputScript(w.to, bitcoin.networks.testnet); // throws on a bad address
      const rate = await this.feeRate();
      const utxos = await this.usableUtxos(address, rate);
      const sel = coinSelect(
        utxos.map((u) => ({ txId: u.txid, vout: u.vout, value: u.value, script: Buffer.from(script) })),
        [{ address: w.to, value }],
        rate,
      );
      if (!sel.inputs || !sel.outputs) throw new Error(`withdrawal ${w.id}: vault ${address} cannot cover ${value} sats plus fees`);
      return {
        inputs: sel.inputs.map((i) => ({ txid: i.txId, vout: i.vout, value: i.value })),
        outputs: sel.outputs.map((o) => ({ address: o.address ?? address, value: o.value! })),
        pays: { owner: [w.to, String(value)] },
        sigs: [],
      };
    });
    if (!tx) throw new Error(`withdrawal ${w.id}: nothing to send`);
    return tx.hash;
  }

  /**
   * Plans a tx once, gets each input signed through the contract's gated request_signature (saving
   * every signature as it arrives), saves the signed tx, then broadcasts it. A saved tx is only ever
   * rebroadcast, never signed again; null when the plan has nothing to send.
   */
  private async signAndBroadcast(
    key: string,
    owner: string,
    purpose: SignPurpose,
    makePlan: (address: string, script: Uint8Array) => Promise<BtcSigning | null>,
  ): Promise<PendingTx | null> {
    let pending = this.store.get().pendingTxs[key];
    if (!pending) {
      const { address, publicKey } = await this.derive(owner);
      const script = bitcoin.address.toOutputScript(address, bitcoin.networks.testnet);
      let plan = this.store.get().btcSigning[key];
      if (!plan) {
        const p = await makePlan(address, script);
        if (!p) return null;
        plan = p;
        const saved = plan;
        this.store.update((s) => (s.btcSigning[key] = saved));
      }

      const { transaction, hashesToSign } = await this.btc.prepareTransactionForSigning({
        publicKey,
        inputs: plan.inputs.map((i) => ({ txid: i.txid, vout: i.vout, value: i.value, scriptPubKey: script })),
        outputs: plan.outputs,
      });
      for (let i = plan.sigs.length; i < hashesToSign.length; i++) {
        // Sequential: each MPC sign takes ~1 min and shares the agent's NEAR access keys. Each one is
        // saved at once, so a timeout or restart resumes here instead of spending the contract's cap.
        const sig = toRSV((await this.contract.requestSignature(owner, "Btc", uint8ArrayToHex(hashesToSign[i]), purpose)) as MPCSignature);
        this.store.update((s) => s.btcSigning[key].sigs.push(sig));
      }
      const raw = this.btc.finalizeTransactionSigning({ transaction, rsvSignatures: this.store.get().btcSigning[key].sigs });
      const hash = bitcoin.Transaction.fromHex(raw).getId();
      pending = { raw, hash, pays: plan.pays, inputs: plan.inputs.map(({ txid, vout }) => ({ txid, vout })) };
      const saved = pending;
      this.store.update((s) => {
        s.pendingTxs[key] = saved;
        delete s.btcSigning[key];
      });
    }
    await this.broadcast(key, pending);
    return pending;
  }

  /**
   * The vault's UTXOs worth spending, largest first, at most MAX_INPUTS. A UTXO worth less than the
   * fee to spend it only costs the heirs, and past MAX_INPUTS the smallest stay behind (the
   * contract's signature cap). mempool.space keeps listing a UTXO for a while after it is spent, and
   * a tx built on one is dead with its signatures wasted, so candidates are checked (at most
   * 2 × MAX_INPUTS lookups).
   */
  private async usableUtxos(address: string, rate: number): Promise<Utxo[]> {
    const candidates = (await this.utxos(address)).filter((u) => u.value > VB_INPUT * rate).sort((a, b) => b.value - a.value);
    const utxos: Utxo[] = [];
    for (const u of candidates.slice(0, 2 * MAX_INPUTS)) {
      if (utxos.length === MAX_INPUTS) break;
      if (!(await this.spentBy(u))) utxos.push(u);
    }
    return utxos;
  }

  /** Inputs and outputs for a stage, or null when there is nothing above dust to send. */
  private async plan(job: StageJob, address: string, script: Uint8Array): Promise<BtcSigning | null> {
    const rate = await this.feeRate();
    const utxos = await this.usableUtxos(address, rate);
    let inputs: Utxo[];
    let outputs: { address: string; value: number }[];
    let targets: Map<string, bigint>;

    if (job.isLast) {
      // Sweep: the usable UTXOs in, one output per heir, no change.
      inputs = utxos;
      const feeFor = (nOut: number) => BigInt(Math.ceil((VB_OVERHEAD + VB_INPUT * inputs.length + VB_OUTPUT * nOut) * rate));
      targets = dustSafeTargets(job, feeFor, BigInt(DUST_SATS));
      outputs = [...targets].map(([id, v]) => ({ address: job.recipients[id], value: Number(v) }));
    } else {
      targets = dustSafeTargets(job, () => 0n, BigInt(DUST_SATS));
      if (!targets.size) return null;
      const sel = coinSelect(
        utxos.map((u) => ({ txId: u.txid, vout: u.vout, value: u.value, script: Buffer.from(script) })),
        [...targets].map(([id, v]) => ({ address: job.recipients[id], value: Number(v) })),
        rate,
      );
      if (!sel.inputs || !sel.outputs) throw new Error(`vault ${address} cannot cover stage ${job.stage} plus fees`);
      inputs = sel.inputs.map((i) => ({ txid: i.txId, vout: i.vout, value: i.value }));
      outputs = sel.outputs.map((o) => ({ address: o.address ?? address, value: o.value! })); // no address = change
    }
    if (!outputs.length) return null;
    for (const o of outputs) {
      if (o.value < DUST_SATS) throw new Error(`output of ${o.value} sats to ${o.address} is below dust`);
    }
    return { inputs, outputs, pays: Object.fromEntries([...targets].map(([id, v]) => [id, [job.recipients[id], v.toString()]])), sigs: [] };
  }

  private async broadcast(key: string, tx: { raw: string; hash: string; inputs?: { txid: string; vout: number }[] }) {
    const res = await this.fetchImpl(`${this.api}/tx`, { method: "POST", body: tx.raw });
    if (res.ok) return;
    // Already broadcast (mempool or mined) is fine; anything else is an error.
    const known = await this.fetchImpl(`${this.api}/tx/${tx.hash}`);
    if (known.ok) return;
    const why = `${res.status} ${await res.text()}`;
    // Built from a stale UTXO list (mempool.space lists a spent UTXO for a while): if another tx spent
    // one of our inputs, this tx can never land, so it is dropped and the stage is planned again.
    for (const i of tx.inputs ?? []) {
      const by = await this.spentBy(i);
      if (by && by !== tx.hash) {
        this.store.update((s) => delete s.pendingTxs[key]);
        throw new Error(`BTC tx ${tx.hash} is dead (input ${i.txid}:${i.vout} spent by ${by}); re-planning the stage`);
      }
    }
    throw new Error(`BTC broadcast failed: ${why}`);
  }

  /** The txid that spends this outpoint (mempool or mined), or null. A failed lookup counts as unspent. */
  private async spentBy(o: { txid: string; vout: number }): Promise<string | null> {
    const res = await this.fetchImpl(`${this.api}/tx/${o.txid}/outspend/${o.vout}`);
    if (!res.ok) return null;
    const spend = (await res.json()) as { spent: boolean; txid?: string };
    return spend.spent ? (spend.txid ?? "unknown") : null;
  }
}
