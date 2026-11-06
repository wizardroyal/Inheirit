// Staged release on foreign chains (CLAUDE.md §7.4). NEAR stages are paid by the contract itself
// in advance(); this releases the ETH/BTC vault stages the contract has reached.
// Idempotent: transfers already recorded on-chain are skipped, and each chain vault saves its
// signed tx before broadcasting so a retry rebroadcasts instead of re-signing.
import type { Asset, Policy } from "../policy/policy";
import { policyHash, sharesFor } from "../policy/policy";
import { type ForeignChain, stateName, type WillContract, type WillView } from "../near/will-contract";
import type { Store } from "../state/store";
import type { Executor } from "../escalation/driver";
import { stageAmount } from "./amounts";

export interface StageJob {
  owner: string;
  round: number;
  stage: number;
  isLast: boolean;
  /** Gross amount this stage releases, before fees (smallest units). */
  gross: bigint;
  /** Percent shares of this asset per heir id (sum 100), for heirs not yet paid this stage. */
  unpaidShares: Record<string, number>;
  /** Heir id -> receive address on this chain. */
  recipients: Record<string, string>;
}

export interface SentTransfer {
  heirId: string;
  to: string;
  amount: bigint;
  txHash: string;
}

export interface ChainVault {
  chain: ForeignChain;
  asset: Exclude<Asset, "NEAR">;
  address(owner: string): Promise<string>;
  balance(owner: string): Promise<bigint>;
  /** Builds, gets signed (via the contract's gated request_signature), and broadcasts the stage. */
  sendStage(job: StageJob): Promise<SentTransfer[]>;
  /** Sends an owner's pending withdrawal (signed with the Withdrawal purpose); returns the tx hash. */
  sendWithdrawal?(owner: string, w: { id: number; to: string; amount: string }): Promise<string>;
}

export class StagedExecutor implements Executor {
  constructor(
    private readonly contract: WillContract,
    private readonly vaults: ChainVault[],
    private readonly store: Store,
    private readonly log: (msg: string) => void = (m) => console.log(m),
  ) {}

  /**
   * The owner's pending withdrawals from foreign vaults (§5.2; principle 6: the owner never loses
   * control while alive). The contract signs them only while the will is Active and only for a
   * matching request on the same chain; NEAR withdrawals are paid by the contract itself.
   */
  async withdraw(owner: string, will: WillView): Promise<void> {
    if (stateName(will.state) !== "Active") return;
    for (const w of will.pending_withdrawals) {
      if (w.chain === "Near") continue;
      const vault = this.vaults.find((v) => v.chain === w.chain);
      if (!vault?.sendWithdrawal) continue;
      try {
        const tx = await vault.sendWithdrawal(owner, w);
        await this.contract.completeWithdrawal(owner, w.id, tx);
        this.log(`[executor] ${owner}: withdrawal ${w.id} sent on ${w.chain} (${tx})`);
      } catch (e) {
        this.log(`[executor] ${owner} withdrawal ${w.id} on ${w.chain}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async run(owner: string, will: WillView): Promise<void> {
    if (stateName(will.state) !== "Executing" || typeof will.state === "string" || !("Executing" in will.state)) return;
    const current = will.state.Executing.stage;
    const policy = this.store.get().policies[owner];
    if (!policy || policyHash(policy) !== will.policy_hash) {
      this.log(`[executor] ${owner}: no approved policy matching the on-chain policy_hash; foreign vaults not released`);
      return;
    }
    for (const chain of will.foreign_chains) {
      const vault = this.vaults.find((v) => v.chain === chain);
      if (!vault) {
        this.log(`[executor] ${owner}: no vault adapter for ${chain}`);
        continue;
      }
      // Stages in order; stop this chain at the first failure and retry next tick.
      for (let stage = 0; stage <= current; stage++) {
        if (will.stage_done.some((d) => d.stage === stage && d.chain === chain)) continue;
        try {
          await this.runStage(owner, will, policy, vault, stage);
        } catch (e) {
          this.log(`[executor] ${owner} ${chain} stage ${stage}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
    }
  }

  private async runStage(owner: string, will: WillView, policy: Policy, vault: ChainVault, stage: number) {
    const round = will.execution_round;
    const chain = vault.chain;
    const balance = await vault.balance(owner);
    const recorded = will.executions.filter((e) => e.round === round && e.chain === chain);

    // Snapshot at the start of the round; if lost (agent restarted), rebuild from what was sent.
    const snapKey = `${owner}:${round}:${chain}`;
    let snapshot = this.store.get().snapshots[snapKey];
    if (!snapshot) {
      const sent = recorded.reduce((s, e) => s + BigInt(e.amount), 0n);
      snapshot = (balance + sent).toString();
      this.store.update((s) => (s.snapshots[snapKey] = snapshot!));
    }

    const shares = sharesFor(policy, vault.asset);
    const paidThisStage = new Set(recorded.filter((e) => e.stage === stage).map((e) => e.to));
    const recipients: Record<string, string> = {};
    const unpaidShares: Record<string, number> = {};
    for (const heir of policy.heirs) {
      const addr = vault.asset === "ETH" ? heir.receive.eth : heir.receive.btc;
      const pct = shares[heir.id] ?? 0;
      if (!addr || pct === 0) continue;
      recipients[heir.id] = addr;
      if (!paidThisStage.has(addr)) unpaidShares[heir.id] = pct;
    }

    const pcts = will.round_stages.map((s) => s.pct);
    const isLast = stage === pcts.length - 1;
    const gross = stageAmount(BigInt(snapshot), pcts, stage, balance);
    if (Object.keys(unpaidShares).length && gross > 0n) {
      const sent = await vault.sendStage({ owner, round, stage, isLast, gross, unpaidShares, recipients });
      for (const t of sent) {
        await this.contract.recordExecution(owner, stage, chain, t.to, t.amount.toString(), t.txHash);
        this.log(`[executor] ${owner} ${chain} stage ${stage}: sent ${t.amount} to ${t.heirId} (${t.to}) tx ${t.txHash}`);
      }
    } else {
      this.log(`[executor] ${owner} ${chain} stage ${stage}: nothing to send`);
    }
    await this.contract.markStageDone(owner, stage, chain);
  }
}
