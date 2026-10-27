// ETH vault on Sepolia: an address derived by the MPC network from (contract account, vault path).
// One 21000-gas transfer per heir per stage, signed through the contract's gated request_signature.
import { chainAdapters, contracts, utils, type MPCSignature } from "chainsig.js";
import { createPublicClient, http, keccak256, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { stageTargets } from "../executor/amounts";
import type { ChainVault, SentTransfer, StageJob } from "../executor/executor";
import type { WillContract } from "../near/will-contract";
import type { Store } from "../state/store";
import { MPC_CONTRACT_ID, vaultPath } from "./vault-path";

const { toRSV, uint8ArrayToHex } = utils.cryptography;
const TRANSFER_GAS = 21_000n;
const ALREADY_SENT = /already known|nonce too low|known transaction|replacement transaction underpriced/i;

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
    const feePerTx = TRANSFER_GAS * maxFeePerGas;
    const targets = stageTargets(job, feePerTx * BigInt(Object.keys(job.unpaidShares).length));
    const sent: SentTransfer[] = [];

    for (const [heirId, amount] of targets) {
      const to = job.recipients[heirId] as Hex;
      const key = `${job.owner}:${job.round}:${job.stage}:Eth:${heirId}`;
      let pending = this.store.get().pendingTxs[key];
      if (!pending) {
        const balance = await this.client.getBalance({ address: from });
        if (balance < amount + feePerTx) throw new Error(`vault ${from} has ${balance} wei, needs ${amount + feePerTx}`);
        const nonce = await this.client.getTransactionCount({ address: from, blockTag: "pending" });
        const { transaction, hashesToSign } = await this.evm.prepareTransactionForSigning({
          from,
          to,
          value: amount,
          gas: TRANSFER_GAS,
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
      await this.broadcast(pending.raw as Hex);
      const receipt = await this.client.waitForTransactionReceipt({ hash: pending.hash as Hex, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error(`tx ${pending.hash} reverted`);
      const [paidTo, paidAmount] = pending.pays[heirId];
      sent.push({ heirId, to: paidTo, amount: BigInt(paidAmount), txHash: pending.hash });
    }
    return sent;
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
