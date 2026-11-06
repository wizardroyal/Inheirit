// Scenario B with NEAR Intents payouts (CLAUDE.md §J.9), headless, on the SIMULATED 1Click client.
// Two heirs, stable-value mode: Ada chooses ETH on Base before anything happens (stable mode turns it
// into USDC on Base); Tobi chooses only after two slices were released, so his slices wait and then
// pay out together. Small slices accumulate until they reach the $1 minimum; the rest goes out when
// the release ends.
// Usage: AGENT_URL=<agent> DEMO_OWNER=<name> npx tsx scripts/demo-payout.ts
import { KeyPairSigner } from "@near-js/signers";
import { randomBytes } from "node:crypto";
import { checkPolicy } from "../src/policy/policy";
import { loadKeys } from "./demo-keys";
import { acceptGuardians, call, CONTRACT, ensureSubaccount, NEAR, nearblocks, sleep, stateName, view, willConfig } from "./lib/near";

const AGENT = process.env.AGENT_URL || "http://localhost:3000";
const OWNER_NAME = process.env.DEMO_OWNER || "payo";
const BASE_ETH = "nep141:base.omft.near";
const SOL_SOL = "nep141:sol.omft.near";

async function agent(path: string, body?: unknown) {
  const res = await fetch(`${AGENT}${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

const owner = await ensureSubaccount(OWNER_NAME, 1.6);
const ada = await ensureSubaccount("ada", 0.2);
const tobi = await ensureSubaccount("tobi", 0.2);
const g1 = await ensureSubaccount("g1", 0.3);
const g2 = await ensureSubaccount("g2", 0.3);

const check = checkPolicy({
  version: 1,
  owner,
  heirs: [
    { id: "ada", name: "Ada", near_account: ada },
    { id: "tobi", name: "Tobi", near_account: tobi },
  ],
  allocations: [{ asset: "NEAR", shares: { ada: 50, tobi: 50 } }],
  stages_pct: [10, 20, 30, 40],
  guardians: [g1, g2],
  guardian_threshold: 2,
  payout_value_mode: "stable",
});
if (!check.ok) throw new Error(check.errors.join("; "));
const policy = check.policy;

// DEMO_RESUME=1 continues a run whose will already exists (e.g. after a crash of this script).
if (!process.env.DEMO_RESUME) {
  if (await view("get_will", { owner })) throw new Error(`${owner} already has a will; use another DEMO_OWNER`);
  console.log(`create_will ${nearblocks((await call(owner, "create_will", { config: willConfig(policy, []) }, NEAR / 10n)).hash)}`);
  await acceptGuardians(owner, policy.guardians);
  console.log(`deposit 1 NEAR ${nearblocks((await call(owner, "deposit_near", {}, NEAR)).hash)}`);
  await agent("/api/policy", { owner, policy });
  await agent("/api/owners", { signed: await signed(owner, "register_owner", {}) });

  const adaChoice = await agent("/api/heir/payout", { signed: await signed(ada, "payout_pref", { owner, blockchain: "base", asset_id: BASE_ETH, address: "0x1111111111111111111111111111111111111111" }) });
  console.log(`Ada chose ${adaChoice.pref.symbol} on ${adaChoice.pref.blockchain} (simulated client: ${adaChoice.simulated})`);
  const early = await agent(`/api/payouts/${owner}`);
  if (early.started || Object.keys(early.heirs).length) throw new Error("payouts revealed heirs before release");
}
console.log("Before release: /api/payouts reveals no heirs. Owner goes silent…");

const t0 = Date.now();
const at = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
type Will = { state: unknown; executions: unknown[] };
let last = "";
async function waitFor(pred: (w: Will) => boolean, maxS: number): Promise<Will> {
  const end = Date.now() + maxS * 1000;
  for (;;) {
    let w: Will | null = null;
    try {
      w = await view<Will>("get_will", { owner });
    } catch {
      // RPC hiccup; retry
    }
    if (w) {
      const ex = typeof w.state === "object" && w.state && "Executing" in w.state ? (w.state as { Executing: { stage: number } }).Executing.stage : null;
      const s = `${stateName(w.state)}${ex === null ? "" : `{${ex}}`}`;
      if (s !== last) console.log(`${at()} state: ${(last = s)}`);
      if (pred(w)) return w;
    }
    if (Date.now() > end) throw new Error(`timed out in ${last}`);
    await sleep(5);
  }
}

await waitFor((w) => stateName(w.state) === "GuardianVote", 600);
for (const g of policy.guardians) console.log(`  ${g} attests ${nearblocks((await call(g, "attest", { owner, kind: "Deceased" })).hash)}`);
await waitFor((w) => w.executions.filter((e) => (e as { chain: string }).chain === "Near").length >= 4, 900); // stages 1 and 2 for both heirs
const tobiChoice = await agent("/api/heir/payout", { signed: await signed(tobi, "payout_pref", { owner, blockchain: "sol", asset_id: SOL_SOL, address: "So11111111111111111111111111111111111111112" }) });
console.log(`${at()} Tobi chose ${tobiChoice.pref.symbol} on ${tobiChoice.pref.blockchain}, after two slices`);
await waitFor((w) => stateName(w.state) !== "Executing", 900);

let p: { heirs: Record<string, { batches: { slices: string[]; status: string; destSymbol: string; destChain: string; amountUsd: number; stable: boolean }[]; waiting: unknown[] }> } | null = null;
for (let i = 0; i < 24; i++) {
  p = await agent(`/api/payouts/${owner}`);
  const all = Object.values(p!.heirs).flatMap((h) => h.batches);
  const waiting = Object.values(p!.heirs).flatMap((h) => h.waiting);
  if (all.length && all.every((b) => b.status === "SUCCESS") && !waiting.length) break;
  await sleep(10);
}
for (const [heir, h] of Object.entries(p!.heirs)) {
  console.log(`${heir}:`);
  for (const b of h.batches) console.log(`  stages ${b.slices.map((k) => Number(k.split(":")[1]) + 1).join("+")} ≈ $${b.amountUsd} → ${b.destSymbol} on ${b.destChain}${b.stable ? " (stable)" : ""}: ${b.status}`);
  if (h.waiting.length) console.log(`  still waiting: ${h.waiting.length}`);
}
const adaB = p!.heirs[ada].batches;
const tobiB = p!.heirs[tobi].batches;
const ok =
  adaB.every((b) => b.destSymbol === "USDC" && b.destChain === "base" && b.status === "SUCCESS") &&
  adaB.flatMap((b) => b.slices).length === 4 &&
  tobiB.every((b) => b.destSymbol === "USDC" && b.destChain === "sol" && b.status === "SUCCESS") &&
  tobiB.flatMap((b) => b.slices).length === 4 &&
  tobiB[0].slices.length >= 2;
console.log(ok ? `\nPayout scenario passed on ${CONTRACT} (SIMULATED 1Click).` : "\nPayout scenario FAILED");
process.exit(ok ? 0 : 1);
