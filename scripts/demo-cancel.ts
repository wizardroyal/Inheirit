// Scenario A (CLAUDE.md §9), headless: "silence doesn't kill you".
// A demo will goes silent; the running agent escalates it; two guardians attest; during the challenge
// a lone SIMULATED X post is ignored; then a heartbeat signed by the owner (NEP-413) cancels
// everything, and no funds move. Requires the agent running in DEMO_MODE against this contract.
//
// Usage: AGENT_URL=http://localhost:3000 DEMO_OWNER=carol npx tsx scripts/demo-cancel.ts
import { KeyPairSigner } from "@near-js/signers";
import { randomBytes } from "node:crypto";
import { checkPolicy } from "../src/policy/policy";
import { loadKeys } from "./demo-keys";
import { acceptGuardians, call, CONTRACT, ensureSubaccount, NEAR, nearblocks, sleep, stateName, view, willConfig } from "./lib/near";

const AGENT = process.env.AGENT_URL || "http://localhost:3000";
const OWNER_NAME = process.env.DEMO_OWNER || "carol";

async function agentPost(path: string, body: unknown) {
  const res = await fetch(`${AGENT}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** NEP-413 request signed with the owner's demo key, as the web app's heartbeat sends it. */
async function signed(accountId: string, action: string, data?: unknown) {
  const message = JSON.stringify({ action, owner: accountId, issued_at: Date.now(), data });
  const nonce = randomBytes(32);
  const s = await KeyPairSigner.fromSecretKey(loadKeys()[accountId] as never).signNep413Message(message, accountId, CONTRACT, nonce);
  return { account_id: accountId, public_key: s.publicKey.toString(), signature: Buffer.from(s.signature).toString("base64"), nonce: nonce.toString("base64"), message };
}

const owner = await ensureSubaccount(OWNER_NAME, 1.5);
const heir = await ensureSubaccount("bola", 0.5);
const g1 = await ensureSubaccount("g1", 0.3);
const g2 = await ensureSubaccount("g2", 0.3);

const check = checkPolicy({
  version: 1,
  owner,
  heirs: [{ id: "bola", name: "Bola", near_account: heir }],
  allocations: [{ asset: "NEAR", shares: { bola: 100 } }],
  stages_pct: [10, 20, 30, 40],
  guardians: [g1, g2],
  guardian_threshold: 2,
});
if (!check.ok) throw new Error(check.errors.join("; "));
const policy = check.policy;

type Will = { state: unknown; near_balance: string; executions: unknown[] };
if (await view("get_will", { owner })) throw new Error(`${owner} already has a will; use another DEMO_OWNER`);
const created = await call(owner, "create_will", { config: willConfig(policy, []) }, NEAR / 10n);
console.log(`create_will ${nearblocks(created.hash)}`);
await acceptGuardians(owner, policy.guardians);
console.log(`deposit 0.5 NEAR ${nearblocks((await call(owner, "deposit_near", {}, NEAR / 2n)).hash)}`);
await agentPost("/api/policy", { owner, policy });
await agentPost("/api/owners", { signed: await signed(owner, "register_owner", {}) });
console.log("Owner goes silent. The agent escalates: Quiet -> WelfareCheck -> GuardianVote (about 4 min)…");

const t0 = Date.now();
const at = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
async function waitState(want: string, maxS: number): Promise<Will> {
  let last = "";
  for (let i = 0; i < maxS / 5; i++) {
    const w = (await view<Will>("get_will", { owner }))!;
    const s = stateName(w.state)!;
    if (s !== last) console.log(`${at()} state: ${s}`);
    last = s;
    if (s === want) return w;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${want}`);
}

await waitState("GuardianVote", 600);
for (const g of [g1, g2]) console.log(`  ${g} attests Deceased ${nearblocks((await call(g, "attest", { owner, kind: "Deceased" })).hash)}`);
await waitState("Challenge", 60);

await agentPost("/demo/signal", { owner, source: "x" });
console.log(`${at()} SIMULATED X post sent; a lone weak signal must not count. Waiting 40 s…`);
await sleep(40);
const still = stateName((await view<Will>("get_will", { owner }))!.state);
if (still !== "Challenge") throw new Error(`a lone X post changed the state to ${still}`);
console.log(`${at()} still Challenge`);

await agentPost("/api/heartbeat", { signed: await signed(owner, "heartbeat") });
console.log(`${at()} heartbeat signed by ${owner} sent`);
const w = await waitState("Active", 90);
if (w.executions.length) throw new Error("funds moved");
console.log(`\nScenario A passed on ${CONTRACT}: silence + guardian quorum reached Challenge; a lone X post was ignored; a signed heartbeat cancelled. NEAR vault untouched (${w.near_balance} yocto).`);
