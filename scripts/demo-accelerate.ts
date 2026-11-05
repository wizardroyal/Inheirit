// Acceleration (CLAUDE.md §5.5), headless. A will with a lawyer goes silent; during the guardian
// vote the lawyer attests a death proof. That only switches the will to the accelerated schedule:
// the guardian quorum is still needed, the challenge period is not skipped, no stage is skipped,
// and the notes still come last. Requires the agent running in DEMO_MODE against this contract.
//
// Usage: AGENT_URL=… DEMO_FUNDER_ACCOUNT=… DEMO_OWNER=accel npx tsx scripts/demo-accelerate.ts
import { KeyPairSigner } from "@near-js/signers";
import { createHash, randomBytes } from "node:crypto";
import { checkPolicy } from "../src/policy/policy";
import { loadKeys } from "./demo-keys";
import { acceptGuardians, call, CONTRACT, ensureSubaccount, NEAR, nearblocks, sleep, stateName, view, willConfig } from "./lib/near";

const AGENT = process.env.AGENT_URL || "http://localhost:3000";
const OWNER_NAME = process.env.DEMO_OWNER || "accel";

async function agentPost(path: string, body: unknown) {
  const res = await fetch(`${AGENT}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function signed(accountId: string, action: string, data?: unknown) {
  const message = JSON.stringify({ action, owner: accountId, issued_at: Date.now(), data });
  const nonce = randomBytes(32);
  const s = await KeyPairSigner.fromSecretKey(loadKeys()[accountId] as never).signNep413Message(message, accountId, CONTRACT, nonce);
  return { account_id: accountId, public_key: s.publicKey.toString(), signature: Buffer.from(s.signature).toString("base64"), nonce: nonce.toString("base64"), message };
}

const owner = await ensureSubaccount(OWNER_NAME, 1);
const heir = await ensureSubaccount("bola", 0.5);
const g1 = await ensureSubaccount("g1", 0.3);
const g2 = await ensureSubaccount("g2", 0.3);
const lawyer = await ensureSubaccount("lawyer", 0.3);
if (await view("get_will", { owner })) throw new Error(`${owner} already has a will; use another DEMO_OWNER`);

const check = checkPolicy({
  version: 1,
  owner,
  heirs: [{ id: "bola", name: "Bola", near_account: heir }],
  allocations: [{ asset: "NEAR", shares: { bola: 100 } }],
  stages_pct: [10, 20, 30, 40],
  guardians: [g1, g2],
  guardian_threshold: 2,
  lawyer,
});
if (!check.ok) throw new Error(check.errors.join("; "));
const policy = check.policy;
const config = willConfig(policy, []);
console.log(`create_will ${nearblocks((await call(owner, "create_will", { config }, NEAR / 10n)).hash)}`);
console.log(`deposit 0.5 NEAR ${nearblocks((await call(owner, "deposit_near", {}, NEAR / 2n)).hash)}`);
await acceptGuardians(owner, policy.guardians);
await agentPost("/api/policy", { owner, policy });
await agentPost("/api/owners", { signed: await signed(owner, "register_owner", {}) });

type Will = { state: Record<string, { since?: number; stage?: number; stage_started?: number }> | string; accelerated: boolean; round_stages: { pct: number; wait_after: number }[]; near_balance: string };
const t0 = Date.now();
const at = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const will = async () => (await view<Will>("get_will", { owner }))!;
async function waitState(want: string, maxS: number): Promise<Will> {
  let last = "";
  for (let i = 0; i < maxS / 3; i++) {
    const w = await will();
    const s = stateName(w.state)!;
    if (s !== last) console.log(`${at()} state: ${s}${s === "Executing" ? ` stage ${(w.state as { Executing: { stage: number } }).Executing.stage + 1}` : ""}`);
    last = s;
    if (s === want) return w;
    await sleep(3);
  }
  throw new Error(`timed out waiting for ${want}`);
}

await waitState("GuardianVote", 600);
const evidence = createHash("sha256").update("demo death certificate").digest("hex");
console.log(`  lawyer attests a death proof ${nearblocks((await call(lawyer, "attest_death_proof", { owner, evidence_hash: evidence })).hash)}`);
let w = await will();
if (!w.accelerated) throw new Error("the lawyer's death proof did not accelerate the will");
if (stateName(w.state) !== "GuardianVote") throw new Error(`the death proof skipped the vote: ${stateName(w.state)}`);
console.log(`${at()} accelerated; still GuardianVote: the guardian quorum is still needed`);
for (const g of [g1, g2]) console.log(`  ${g} attests Deceased ${nearblocks((await call(g, "attest", { owner, kind: "Deceased" })).hash)}`);
w = await waitState("Challenge", 60);
const challengeAt = Date.now();
w = await waitState("Executing", 400);
const challengeS = Math.round((Date.now() - challengeAt) / 1000);
if (challengeS < config.timings.challenge_period - 5) throw new Error(`the challenge period was cut short (${challengeS} s)`);
console.log(`${at()} challenge period lasted ~${challengeS} s (configured ${config.timings.challenge_period} s): not skipped`);
const pcts = w.round_stages.map((s) => s.pct);
console.log(`${at()} executing on the accelerated schedule: ${w.round_stages.map((s) => `${s.pct}% then ${s.wait_after} s`).join(", ")}`);
if (JSON.stringify(pcts) !== JSON.stringify(config.accelerated_stages.map((s) => s.pct))) throw new Error(`round stages ${pcts} are not the accelerated schedule`);
await waitState("Completed", 900);
console.log(`\nAcceleration passed on ${CONTRACT}: lawyer death proof -> accelerated schedule; quorum still required; challenge period kept; all ${pcts.length} stages ran; vault ${(await will()).near_balance} yocto left.`);
