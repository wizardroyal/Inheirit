// Scenario B (CLAUDE.md §9), headless: "it actually executes".
// A demo will with NEAR + Sepolia + BTC testnet4 vaults goes silent; the running agent escalates
// it; two guardians attest; after the challenge period it executes in two stages and funds land
// on all three chains. Requires the agent running (npm run dev) in DEMO_MODE with this contract,
// and the ETH/BTC vaults funded (npx tsx scripts/vault-addresses.ts <owner>).
//
// Usage: npx tsx scripts/demo-execute.ts
import { checkPolicy } from "../src/policy/policy";
import { demoHeirAddresses } from "./demo-keys";
import { acceptGuardians, call, CONTRACT, ensureSubaccount, NEAR, nearblocks, signedRequest, sleep, stateName, view, willConfig } from "./lib/near";

const AGENT = process.env.AGENT_URL || "http://localhost:3000";
const OWNER_NAME = process.env.DEMO_OWNER || "alice";

async function agentPost(path: string, body: unknown) {
  const res = await fetch(`${AGENT}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const owner = await ensureSubaccount(OWNER_NAME, 2);
const heir = await ensureSubaccount("bola", 0.5);
const g1 = await ensureSubaccount("g1", 0.3);
const g2 = await ensureSubaccount("g2", 0.3);
const receive = demoHeirAddresses();

const check = checkPolicy({
  version: 1,
  owner,
  heirs: [{ id: "bola", name: "Bola", near_account: heir, receive }],
  allocations: [
    { asset: "NEAR", shares: { bola: 100 } },
    { asset: "ETH", shares: { bola: 100 } },
    { asset: "BTC", shares: { bola: 100 } },
  ],
  stages_pct: [10, 20, 30, 40],
  guardians: [g1, g2],
  guardian_threshold: 2,
});
if (!check.ok) throw new Error(check.errors.join("; "));
const policy = check.policy;

type Will = { state: unknown; executions: { round: number; stage: number; chain: string; to: string; amount: string; tx_hash: string }[]; execution_round: number };
let will = await view<Will | null>("get_will", { owner });
if (!will) {
  const r = await call(owner, "create_will", { config: willConfig(policy, ["Eth", "Btc"]) }, NEAR / 10n);
  console.log(`create_will ${nearblocks(r.hash)}`);
  await acceptGuardians(owner, policy.guardians);
  console.log(`deposit 1 NEAR ${nearblocks((await call(owner, "deposit_near", {}, NEAR)).hash)}`);
} else if (stateName(will.state) !== "Active") {
  throw new Error(`${owner} already has a will in ${stateName(will.state)}; use another DEMO_OWNER`);
}

await agentPost("/api/policy", { owner, policy });
await agentPost("/api/owners", { signed: await signedRequest(owner, "register_owner", {}) });
const vaults = await (await fetch(`${AGENT}/api/vaults/${owner}`)).json();
console.log(`agent is watching ${owner}; vaults ${JSON.stringify(vaults)}`);
console.log("Owner goes silent. The agent escalates: Quiet -> WelfareCheck -> GuardianVote (about 4 min)…");

const t0 = Date.now();
let last = "";
let attested = false;
let seen = 0;
while (Date.now() - t0 < 40 * 60_000) {
  will = (await view<Will>("get_will", { owner }))!;
  const s = stateName(will.state)!;
  if (s !== last) {
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] state: ${s}`);
    last = s;
  }
  if (s === "GuardianVote" && !attested) {
    for (const g of [g1, g2]) console.log(`  ${g} attests Deceased ${nearblocks((await call(g, "attest", { owner, kind: "Deceased" })).hash)}`);
    attested = true;
  }
  const round = will.execution_round;
  for (const e of will.executions.filter((x) => x.round === round).slice(seen)) {
    const link =
      e.chain === "Eth" ? `https://sepolia.etherscan.io/tx/${e.tx_hash}` : e.chain === "Btc" ? `https://mempool.space/testnet4/tx/${e.tx_hash}` : "(NEAR transfer receipt of advance)";
    console.log(`  stage ${e.stage} ${e.chain}: ${e.amount} -> ${e.to} ${link}`);
    seen++;
  }
  if (s === "Completed") {
    console.log(`\nScenario B passed: executed on ${new Set(will.executions.filter((x) => x.round === round).map((x) => x.chain)).size} chains (contract ${CONTRACT}).`);
    process.exit(0);
  }
  await sleep(10);
}
throw new Error("timed out before Completed");
