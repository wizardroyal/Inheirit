// ETH vault on Sepolia: an address derived by the MPC network from (contract account, vault path).
// One native transfer per heir per stage, signed through the contract's gated request_signature.
import { chainAdapters, contracts, utils, type MPCSignature } from "chainsig.js";
import { createPublicClient, http, keccak256, parseTransaction, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { stageTargets } from "../executor/amounts";
import type { ChainVault, SentTransfer, StageJob } from "../executor/executor";
import type { WillContract } from "../near/will-contract";
import type { PendingTx, Store } from "../state/store";
import { MPC_CONTRACT_ID, vaultPath } from "./vault-path";

const { toRSV, uint8ArrayToHex } = utils.cryptography;
// A transfer is not always 21000 gas: Sepolia charges ~207k for the first value transfer to an empty
// account (new-account state surcharge). So estimate per recipient and keep a margin.
const GAS_MARGIN_PCT = 120n;
/** Below this (0.0001 ETH), a last-stage leftover that can't pay its gas is left in the vault. */
const DUST_WEI = 10n ** 14n;
const ALREADY_SENT = /already known|nonce too low|known transaction|replacement transaction underpriced/i;
/** A pending tx must look dead this long (two checks) before it is dropped and re-signed. */
const DEAD_CONFIRM_MS = 120_000;

export class EvmVault implements ChainVault {
  readonly chain = "Eth" as const;
  readonly asset = "ETH" as const;
  private readonly client;
  private readonly evm;
  private readonly addresses = new Map<string, Hex>();

  constructor(
    private readonly contractId: string,
    private readonly contract: WillContract,
    private readonly store: Store,
    rpcUrl: string,
  ) {
    this.client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const mpc = new contracts.ChainSignatureContract({ networkId: "testnet", contractId: MPC_CONTRACT_ID });
    this.evm = new chainAdapters.evm.EVM({ publicClient: this.client as never, contract: mpc });
  }

  async address(owner: string): Promise<Hex> {
    let a = this.addresses.get(owner);
    if (!a) {
      a = (await this.evm.deriveAddressAndPublicKey(this.contractId, vaultPath(owner, "Eth"))).address as Hex;
      this.addresses.set(owner, a);
    }
    return a;
  }

  async balance(owner: string): Promise<bigint> {
    return this.client.getBalance({ address: await this.address(owner) });
  }

  async sendStage(job: StageJob): Promise<SentTransfer[]> {
    const from = await this.address(job.owner);
    const { maxFeePerGas, maxPriorityFeePerGas } = await this.client.estimateFeesPerGas();
    const gasFor: Record<string, bigint> = {};
    for (const heirId of Object.keys(job.unpaidShares)) {
      // Nonzero value: a zero-value call to an empty account doesn't create it, so it would underestimate.
      const estimate = await this.client.estimateGas({ account: from, to: job.recipients[heirId] as Hex, value: 1n });
      gasFor[heirId] = (estimate * GAS_MARGIN_PCT) / 100n;
    }
    const totalFees = Object.values(gasFor).reduce((sum, g) => sum + g * maxFeePerGas, 0n);
    // A leftover too small to pay its own gas would otherwise block the last stage (and so the
    // secrets) forever. A real balance keeps retrying, so a gas spike never drops a slice.
    if (job.isLast && job.gross <= totalFees && job.gross < DUST_WEI) return [];
    const targets = stageTargets(job, totalFees);
    const sent: SentTransfer[] = [];
    // One count for the whole stage, then consecutive nonces: a load-balanced RPC can return a stale
    // "pending" count between two sends, which would give two heirs the same nonce.
    let nextNonce: number | null = null;

    for (const [heirId, amount] of targets) {
      const to = job.recipients[heirId] as Hex;
      const key = `${job.owner}:${job.round}:${job.stage}:Eth:${heirId}`;
      let pending = this.store.get().pendingTxs[key];
      if (!pending) {
        const gas = gasFor[heirId];
        const feePerTx = gas * maxFeePerGas;
        const balance = await this.client.getBalance({ address: from });
        if (balance < amount + feePerTx) throw new Error(`vault ${from} has ${balance} wei, needs ${amount + feePerTx}`);
        const counted = await this.client.getTransactionCount({ address: from, blockTag: "pending" });
        const nonce: number = nextNonce === null ? counted : Math.max(counted, nextNonce);
        nextNonce = nonce + 1;
        const { transaction, hashesToSign } = await this.evm.prepareTransactionForSigning({
          from,
          to,
          value: amount,
          gas,
          maxFeePerGas,
          maxPriorityFeePerGas,
          nonce,
        });
        const signature = await this.contract.requestSignature(job.owner, "Eth", uint8ArrayToHex(hashesToSign[0]), {
          Release: { stage: job.stage },
        });
        const raw = this.evm.finalizeTransactionSigning({ transaction, rsvSignatures: [toRSV(signature as MPCSignature)] }) as Hex;
        pending = { raw, hash: keccak256(raw), pays: { [heirId]: [to, amount.toString()] } };
        const saved = pending;
        this.store.update((s) => (s.pendingTxs[key] = saved));
      }
      nextNonce = Math.max(nextNonce ?? 0, parseTransaction(pending.raw as Hex).nonce! + 1);
      await this.land(key, pending, from);
      const [paidTo, paidAmount] = pending.pays[heirId];
      sent.push({ heirId, to: paidTo, amount: BigInt(paidAmount), txHash: pending.hash });
    }
    return sent;
  }

  /** An owner's withdrawal from the vault while the will is Active (§5.2): exactly `amount` wei to `to`. */
  async sendWithdrawal(owner: string, w: { id: number; to: string; amount: string }): Promise<string> {
    const from = await this.address(owner);
    const key = `${owner}:w${w.id}:Eth`;
    let pending = this.store.get().pendingTxs[key];
    if (!pending) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(w.to)) throw new Error(`withdrawal ${w.id}: ${w.to} is not an EVM address`);
      const to = w.to as Hex;
      const amount = BigInt(w.amount);
      const { maxFeePerGas, maxPriorityFeePerGas } = await this.client.estimateFeesPerGas();
      const gas = ((await this.client.estimateGas({ account: from, to, value: amount > 0n ? amount : 1n })) * GAS_MARGIN_PCT) / 100n;
      const balance = await this.client.getBalance({ address: from });
      if (balance < amount + gas * maxFeePerGas) throw new Error(`withdrawal ${w.id}: vault ${from} has ${balance} wei, needs ${amount + gas * maxFeePerGas}`);
      const nonce = await this.client.getTransactionCount({ address: from, blockTag: "pending" });
      const { transaction, hashesToSign } = await this.evm.prepareTransactionForSigning({ from, to, value: amount, gas, maxFeePerGas, maxPriorityFeePerGas, nonce });
      const signature = await this.contract.requestSignature(owner, "Eth", uint8ArrayToHex(hashesToSign[0]), { Withdrawal: { id: w.id } });
      const raw = this.evm.finalizeTransactionSigning({ transaction, rsvSignatures: [toRSV(signature as MPCSignature)] }) as Hex;
      pending = { raw, hash: keccak256(raw), pays: { owner: [to, amount.toString()] } };
      const saved = pending;
      this.store.update((s) => (s.pendingTxs[key] = saved));
    }
    await this.land(key, pending, from);
    return pending.hash;
  }

  /** Broadcasts a saved tx and waits for it; a reverted or dead tx is dropped so it is re-signed. */
  private async land(key: string, pending: PendingTx, from: Hex) {
    await this.broadcast(pending.raw as Hex);
    let receipt;
    try {
      receipt = await this.client.waitForTransactionReceipt({ hash: pending.hash as Hex, timeout: 180_000 });
    } catch (e) {
      await this.dropIfDead(key, pending, from);
      throw e;
    }
    if (receipt.status !== "success") {
      // A reverted transfer moved no value but used up its nonce. Drop it so the next attempt
      // signs a fresh tx at the next nonce instead of rebroadcasting a dead one forever.
      this.store.update((s) => delete s.pendingTxs[key]);
      throw new Error(`tx ${pending.hash} reverted (gas ${receipt.gasUsed}); will re-sign`);
    }
  }

  /**
   * A pending tx that is unknown to the node while the vault's mined nonce has passed its nonce can
   * never land (another tx used the nonce), so it would be awaited forever. It is dropped and the
   * transfer re-signed, but only after it looked dead on two checks DEAD_CONFIRM_MS apart: a lagging
   * RPC node could otherwise miss our own mined tx and cause a second payment.
   */
  private async dropIfDead(key: string, pending: PendingTx, from: Hex) {
    const known = await this.client.getTransaction({ hash: pending.hash as Hex }).catch(() => null);
    const mined = await this.client.getTransactionCount({ address: from, blockTag: "latest" });
    const dead = !known && mined > parseTransaction(pending.raw as Hex).nonce!;
    if (!dead) {
      if (pending.deadSince) this.store.update((s) => s.pendingTxs[key] && delete s.pendingTxs[key].deadSince);
      return;
    }
    if (!pending.deadSince) {
      const at = new Date().toISOString();
      this.store.update((s) => s.pendingTxs[key] && (s.pendingTxs[key].deadSince = at));
      return;
    }
    if (Date.now() - Date.parse(pending.deadSince) < DEAD_CONFIRM_MS) return;
    this.store.update((s) => delete s.pendingTxs[key]);
    throw new Error(`tx ${pending.hash} can never land (its nonce was used by another tx); will re-sign`);
  }

  private async broadcast(raw: Hex) {
    try {
      await this.client.sendRawTransaction({ serializedTransaction: raw });
    } catch (e) {
      // A rebroadcast of a tx that is already in the mempool or mined is fine.
      if (!ALREADY_SENT.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
}
