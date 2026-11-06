import { describe, expect, it } from "vitest";
import { type ChainVault, type SentTransfer, StagedExecutor, type StageJob } from "../src/executor/executor";
import type { WillContract, WillState, WillView } from "../src/near/will-contract";
import { checkPolicy, policyHash, type Policy } from "../src/policy/policy";
import { Store } from "../src/state/store";

const ETH1 = "0x" + "1".repeat(40);
const ETH2 = "0x" + "2".repeat(40);

function policy(): Policy {
  const r = checkPolicy({
    version: 1,
    owner: "alice.testnet",
    heirs: [
      { id: "h1", name: "Bola", near_account: "bola.testnet", receive: { eth: ETH1 } },
      { id: "h2", name: "Charity", near_account: "charity.testnet", receive: { eth: ETH2 } },
    ],
    allocations: [
      { asset: "NEAR", shares: { h1: 50, h2: 50 } },
      { asset: "ETH", shares: { h1: 75, h2: 25 } },
    ],
    stages_pct: [40, 60],
    guardians: ["g1.testnet"],
    guardian_threshold: 1,
  });
  if (!r.ok) throw new Error(r.errors.join());
  return r.policy;
}

function will(stage: number, extra: Partial<WillView> = {}): WillView {
  const state: WillState = { Executing: { stage, since: 0, stage_started: 0 } };
  return {
    owner: "alice.testnet",
    heirs: [],
    guardians: [],
    guardian_threshold: 1,
    contacts: [],
    stages: [{ pct: 40, wait_after: 1 }, { pct: 60, wait_after: 1 }],
    accelerated_stages: [{ pct: 100, wait_after: 1 }],
    round_stages: [{ pct: 40, wait_after: 1 }, { pct: 60, wait_after: 1 }],
    timings: { quiet_after: 1, nudge_period: 1, welfare_period: 1, vote_period: 1, challenge_period: 1, secrets_buffer: 1 },
    policy_hash: policyHash(policy()),
    foreign_chains: ["Eth"],
    lawyer: null,
    heirs_hidden: true,
    accelerated: false,
    state,
    last_alive_at: 0,
    execution_round: 1,
    near_balance: "0",
    pending_withdrawals: [],
    executions: [],
    stage_done: [],
    sealed_notes: [],
    released_notes: [],
    ...extra,
  };
}

class FakeVault implements ChainVault {
  chain = "Eth" as const;
  asset = "ETH" as const;
  jobs: StageJob[] = [];
  failStage: number | null = null;
  constructor(public bal: bigint) {}
  async address() {
    return "0xvault";
  }
  async balance() {
    return this.bal;
  }
  withdrawals: number[] = [];
  async sendWithdrawal(_owner: string, w: { id: number }) {
    this.withdrawals.push(w.id);
    return `0xw${w.id}`;
  }
  async sendStage(job: StageJob): Promise<SentTransfer[]> {
    if (job.stage === this.failStage) throw new Error("rpc down");
    this.jobs.push(job);
    return Object.entries(job.unpaidShares).map(([heirId, pct]) => {
      const amount = (job.gross * BigInt(pct)) / 100n;
      this.bal -= amount;
      return { heirId, to: job.recipients[heirId], amount, txHash: `0x${job.stage}${heirId}` };
    });
  }
}

class FakeContract implements Pick<WillContract, "recordExecution" | "markStageDone" | "completeWithdrawal"> {
  records: string[] = [];
  done: string[] = [];
  completed: string[] = [];
  async completeWithdrawal(_o: string, id: number, tx: string) {
    this.completed.push(`${id}:${tx}`);
  }
  async recordExecution(_o: string, stage: number, chain: string, to: string, amount: string) {
    this.records.push(`${stage}:${chain}:${to}:${amount}`);
  }
  async markStageDone(_o: string, stage: number, chain: string) {
    this.done.push(`${stage}:${chain}`);
  }
}

function setup(balance = 1000n) {
  const store = new Store(null);
  store.update((s) => (s.policies["alice.testnet"] = policy()));
  const vault = new FakeVault(balance);
  const contract = new FakeContract();
  const logs: string[] = [];
  const ex = new StagedExecutor(contract as unknown as WillContract, [vault], store, (m) => logs.push(m));
  return { store, vault, contract, ex, logs };
}

describe("StagedExecutor", () => {
  it("sends the owner's pending foreign withdrawals while Active, and only then", async () => {
    const t = setup();
    const pending_withdrawals = [
      { id: 3, chain: "Eth" as const, to: ETH1, amount: "5", signatures: 0 },
      { id: 4, chain: "Near" as const, to: "alice.testnet", amount: "5", signatures: 0 },
    ];
    await t.ex.withdraw("alice.testnet", will(0, { pending_withdrawals }));
    expect(t.vault.withdrawals).toEqual([]); // Executing: the contract would refuse the signature anyway
    await t.ex.withdraw("alice.testnet", will(0, { state: "Active", pending_withdrawals }));
    expect(t.vault.withdrawals).toEqual([3]); // NEAR withdrawals are paid by the contract
    expect(t.contract.completed).toEqual(["3:0xw3"]);
  });

  it("releases stage 0 by policy shares and marks it done", async () => {
    const t = setup();
    await t.ex.run("alice.testnet", will(0));
    expect(t.contract.records).toEqual([`0:Eth:${ETH1}:300`, `0:Eth:${ETH2}:100`]);
    expect(t.contract.done).toEqual(["0:Eth"]);
    expect(t.store.get().snapshots["alice.testnet:1:Eth"]).toBe("1000");
  });

  it("catches up on every reached stage in order, last stage sweeping what is left", async () => {
    const t = setup();
    await t.ex.run("alice.testnet", will(1));
    expect(t.vault.jobs.map((j) => [j.stage, j.isLast, j.gross])).toEqual([
      [0, false, 400n],
      [1, true, 600n],
    ]);
  });

  it("skips stages already done and heirs already paid", async () => {
    const t = setup(700n);
    const executions = [{ round: 1, stage: 1, chain: "Eth" as const, to: ETH1, amount: "450", tx_hash: "0xa" }];
    await t.ex.run("alice.testnet", will(1, { stage_done: [{ stage: 0, chain: "Eth" }], executions }));
    expect(t.vault.jobs).toHaveLength(1);
    expect(t.vault.jobs[0].unpaidShares).toEqual({ h2: 25 });
  });

  it("does nothing without a policy matching the on-chain hash", async () => {
    const t = setup();
    await t.ex.run("alice.testnet", will(0, { policy_hash: "f".repeat(64) }));
    expect(t.vault.jobs).toEqual([]);
    expect(t.logs[0]).toMatch(/no approved policy/);
  });

  it("stops a chain at the first failing stage and does not mark it done", async () => {
    const t = setup();
    t.vault.failStage = 0;
    await t.ex.run("alice.testnet", will(1));
    expect(t.contract.done).toEqual([]);
    expect(t.vault.jobs).toEqual([]);
    expect(t.logs.some((l) => l.includes("rpc down"))).toBe(true);
  });

  it("marks a stage done with nothing to send when the vault is empty", async () => {
    const t = setup(0n);
    await t.ex.run("alice.testnet", will(0));
    expect(t.vault.jobs).toEqual([]);
    expect(t.contract.done).toEqual(["0:Eth"]);
  });

  it("rebuilds a lost snapshot from the balance plus what this round already sent", async () => {
    const t = setup(600n);
    const executions = [
      { round: 1, stage: 0, chain: "Eth" as const, to: ETH1, amount: "300", tx_hash: "0xa" },
      { round: 1, stage: 0, chain: "Eth" as const, to: ETH2, amount: "100", tx_hash: "0xb" },
    ];
    await t.ex.run("alice.testnet", will(1, { stage_done: [{ stage: 0, chain: "Eth" }], executions }));
    expect(t.store.get().snapshots["alice.testnet:1:Eth"]).toBe("1000");
  });
});
