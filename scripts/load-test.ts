// Capacity check (CLAUDE.md §13A.1 item 7): N speedrun wills at once against a running agent.
// Half are "owner returns" (a signed heartbeat once Quiet; we time the snap-back), half are "full
// execution" (guardians attest; NEAR slices 10/20/30/40). For every transition we record how late the
// agent was against the will's own schedule. NEAR only (no foreign vaults), so it costs no test coins.
//
//   DEMO_FUNDER_ACCOUNT=<funder> AGENT_URL=http://localhost:3002 AGENT_CONTRACT_ID=inheirit-dev2.testnet \
//     LOAD_N=10 npx tsx scripts/load-test.ts
// Funder needs ~0.85 NEAR per will. Pass/fail: every transition within +30 s, every snap-back < 20 s.
import { checkPolicy } from "../src/policy/policy";
import { acceptGuardians, call, ensureSubaccount, FUNDER, NEAR, signedRequest, sleep, stateName, view, willConfig } from "./lib/near";

const AGENT = process.env.AGENT_URL || "http://localhost:3002";
const N = Number(process.env.LOAD_N || "10");
const TAG = process.env.LOAD_TAG || Math.random().toString(36).slice(2, 6);
const LATE_OK_S = 30;
const SNAP_OK_S = 20;

type St = Record<string, { since?: number; stage?: number; stage_started?: number; at?: number }> | string;
interface W {
  state: St;
  last_alive_at: number;
  timings: { quiet_after: number; nudge_period: number; welfare_period: number; vote_period: number; challenge_period: number; secrets_buffer: number };
  round_stages: { pct: number; wait_after: number }[];
}

/** Retries the RPC's transient "Transaction has expired" / timeouts (seen on slow connections). */
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 4 || !/expired|timeout|fetch failed|ETIMEDOUT/i.test(String(e))) throw e;
      await sleep(2 + i * 2);
    }
  }
}

async function agentPost(path: string, body: unknown) {
  const res = await fetch(`${AGENT}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

// Accounts come from one funder, so create them one by one (a shared key can't send in parallel).
console.log(`funder ${FUNDER}; ${N} wills, tag ${TAG}`);
const wills: { owner: string; heir: string; guardians: string[]; returns: boolean }[] = [];
for (let i = 0; i < N; i++) {
  const owner = await ensureSubaccount(`lt${TAG}o${i}`, 0.4);
  const heir = await ensureSubaccount(`lt${TAG}h${i}`, 0.02);
  // Script calls reserve 100 Tgas (~0.1 NEAR up front), so guardians need 0.2 to accept and then attest
  const guardians = [await ensureSubaccount(`lt${TAG}g${i}a`, 0.2), await ensureSubaccount(`lt${TAG}g${i}b`, 0.2)];
  wills.push({ owner, heir, guardians, returns: i % 2 === 0 });
}

// Each will is set up by its own accounts, so these run in parallel.
await Promise.all(
  wills.map(async (w) => {
    const check = checkPolicy({
      version: 1,
      owner: w.owner,
      heirs: [{ id: "h", name: "Heir", near_account: w.heir }],
      allocations: [{ asset: "NEAR", shares: { h: 100 } }],
      stages_pct: [10, 20, 30, 40],
      guardians: w.guardians,
      guardian_threshold: 2,
    });
    if (!check.ok) throw new Error(check.errors.join("; "));
    // Idempotent, so a re-run after a failed setup reuses what's already there
    let existing = await view<{ near_balance: string; guardians: { account_id: string; accepted: boolean }[] } | null>("get_will", { owner: w.owner });
    if (!existing) {
      await retry(() => call(w.owner, "create_will", { config: willConfig(check.policy, []) }, NEAR / 10n));
      existing = await view("get_will", { owner: w.owner });
    }
    if (BigInt(existing!.near_balance) === 0n) await retry(() => call(w.owner, "deposit_near", {}, NEAR / 5n));
    for (const g of existing!.guardians.filter((x) => !x.accepted)) await retry(() => acceptGuardians(w.owner, [g.account_id]));
    await agentPost("/api/policy", { owner: w.owner, policy: check.policy });
    await agentPost("/api/owners", { signed: await signedRequest(w.owner, "register_owner", {}) });
  }),
);
console.log(`all ${N} wills created and watched; owners go silent now`);

const late: { owner: string; step: string; lateS: number }[] = [];
const snaps: { owner: string; s: number }[] = [];
const t0 = Date.now();
const el = () => Math.round((Date.now() - t0) / 1000);

async function follow(w: (typeof wills)[number]) {
  let prev: W | null = null;
  let heartbeatAt = 0;
  for (;;) {
    let cur: W;
    try {
      cur = (await view<W>("get_will", { owner: w.owner }))!;
    } catch {
      await sleep(3);
      continue;
    }
    const s = stateName(cur.state)!;
    const ps = prev ? stateName(prev.state) : null;
    const body = (st: St) => (typeof st === "string" ? {} : Object.values(st)[0]);
    if (prev && s !== ps) {
      const since = body(cur.state).since ?? body(cur.state).stage_started ?? body(cur.state).at ?? 0;
      const pb = body(prev.state);
      const t = cur.timings;
      const due: Record<string, number | undefined> = {
        Quiet: prev.last_alive_at + t.quiet_after,
        WelfareCheck: ps === "Quiet" ? (pb.since ?? 0) + t.nudge_period : undefined,
        GuardianVote: ps === "WelfareCheck" ? (pb.since ?? 0) + t.welfare_period : undefined,
        Executing: ps === "Challenge" ? (pb.since ?? 0) + t.challenge_period : undefined,
        SecretsBuffer: ps === "Executing" ? (pb.stage_started ?? 0) + cur.round_stages[pb.stage ?? 0].wait_after : undefined,
        Completed: undefined,
      };
      if (due[s] !== undefined && since) late.push({ owner: w.owner, step: s, lateS: since - due[s]! });
      console.log(`[${el()}s] ${w.owner}: ${ps} -> ${s}`);
    }
    if (prev && s === "Executing" && ps === "Executing" && body(cur.state).stage !== body(prev.state).stage) {
      const pb = body(prev.state);
      const dueS = (pb.stage_started ?? 0) + cur.round_stages[pb.stage ?? 0].wait_after;
      late.push({ owner: w.owner, step: `stage ${(body(cur.state).stage ?? 0) + 1}`, lateS: (body(cur.state).stage_started ?? 0) - dueS });
      console.log(`[${el()}s] ${w.owner}: stage ${(body(cur.state).stage ?? 0) + 1}`);
    }
    if (w.returns) {
      if (s === "Quiet" && !heartbeatAt) {
        heartbeatAt = Date.now();
        await retry(async () => agentPost("/api/heartbeat", { signed: await signedRequest(w.owner, "heartbeat", {}) }));
      }
      if (heartbeatAt && s === "Active") {
        snaps.push({ owner: w.owner, s: Math.round((Date.now() - heartbeatAt) / 1000) });
        console.log(`[${el()}s] ${w.owner}: snapped back in ${snaps[snaps.length - 1].s}s`);
        return;
      }
    } else {
      if (s === "GuardianVote" && ps !== "GuardianVote") for (const g of w.guardians) await retry(() => call(g, "attest", { owner: w.owner, kind: "Deceased" }));
      if (s === "Completed") return;
    }
    if (Date.now() - t0 > 40 * 60_000) throw new Error(`${w.owner}: still ${s} after 40 min`);
    prev = cur;
    await sleep(3);
  }
}

await Promise.all(wills.map(follow));
const worst = late.reduce((m, l) => (l.lateS > m.lateS ? l : m), { owner: "-", step: "-", lateS: -Infinity });
const slowSnap = snaps.reduce((m, x) => Math.max(m, x.s), 0);
console.log(`\ntransitions measured: ${late.length}; latest: ${worst.lateS}s (${worst.step}, ${worst.owner})`);
console.log(`snap-backs: ${snaps.map((x) => x.s).join(", ")} s; slowest ${slowSnap}s`);
const ok = worst.lateS <= LATE_OK_S && slowSnap <= SNAP_OK_S;
console.log(ok ? "PASS" : `FAIL (limits: +${LATE_OK_S}s per transition, ${SNAP_OK_S}s snap-back)`);
process.exit(ok ? 0 : 1);
