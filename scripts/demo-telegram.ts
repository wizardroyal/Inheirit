// Day A checkpoint (CLAUDE.md §12), headless with one human step: the Telegram check.
//  1. A will whose guardians haven't accepted is not armed: it stays Active past quiet_after.
//  2. You link your Telegram to the demo owner with a one-time link (owner-signed request).
//  3. The guardians accept; the will is armed, goes Quiet, and the agent's Telegram check arrives.
//  4. You reply anything in Telegram: the agent records the reply time (never the text) as a
//     medium signal, and the will snaps back to Active.
// Requires the agent running in DEMO_MODE with TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME set.
//
// Usage: AGENT_URL=http://localhost:3002 AGENT_CONTRACT_ID=inheirit-dev2.testnet \
//        DEMO_FUNDER_ACCOUNT=<funder> DEMO_OWNER=tgalice npx tsx scripts/demo-telegram.ts
import { KeyPairSigner } from "@near-js/signers";
import { randomBytes } from "node:crypto";
import { checkPolicy } from "../src/policy/policy";
import { loadKeys } from "./demo-keys";
import { acceptGuardians, call, CONTRACT, ensureSubaccount, NEAR, nearblocks, sleep, stateName, view, willConfig } from "./lib/near";

const AGENT = process.env.AGENT_URL || "http://localhost:3000";
const OWNER_NAME = process.env.DEMO_OWNER || "tgalice";

async function agent(path: string, body?: unknown) {
  const res = await fetch(`${AGENT}${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** NEP-413 request signed with a demo account's key, as the web app sends it. */
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
if (await view("get_will", { owner })) throw new Error(`${owner} already has a will; use another DEMO_OWNER`);

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
const config = willConfig(policy, []);
console.log(`create_will ${nearblocks((await call(owner, "create_will", { config }, NEAR / 10n)).hash)}`);
console.log(`deposit 0.2 NEAR ${nearblocks((await call(owner, "deposit_near", {}, NEAR / 5n)).hash)}`);
await agent("/api/policy", { owner, policy });
await agent("/api/owners", { signed: await signed(owner, "register_owner", {}) });

const t0 = Date.now();
const at = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const state = async () => stateName((await view<{ state: unknown }>("get_will", { owner }))!.state);

// 1 + 2: while the unarmed will sits past quiet_after, link Telegram.
console.log(`${at()} is_armed: ${JSON.stringify(await view("is_armed", { owner }))}`);
const link = await agent("/api/telegram/link", { signed: await signed(owner, "telegram_link") });
const token = new URL(link.url).searchParams.get("start");
console.log(`\n>>> Open this link and press Start (valid 15 min):\n    ${link.url}\n>>> Or send the bot this exact message: /start ${token}\n`);
const quietAfter = config.timings.quiet_after;
for (;;) {
  const linked = (await agent(`/api/telegram/${owner}`)).linked;
  const waited = (Date.now() - t0) / 1000;
  if (linked && waited > quietAfter + 30) break;
  if (waited > 15 * 60) throw new Error("Telegram was not linked within 15 minutes");
  await sleep(5);
}
const s1 = await state();
if (s1 !== "Active") throw new Error(`an unarmed will escalated to ${s1}`);
console.log(`${at()} Telegram linked. Unarmed will still Active after ${quietAfter + 30} s of silence: OK`);

// 3: arm it
await acceptGuardians(owner, policy.guardians);
console.log(`${at()} is_armed: ${JSON.stringify(await view("is_armed", { owner }))}`);
for (let i = 0; (await state()) !== "Quiet"; i++) {
  if (i > 24) throw new Error("did not go Quiet within 2 min of arming");
  await sleep(5);
}
console.log(`${at()} state: Quiet. Checks go out over the next ${config.timings.nudge_period} s (heartbeat app, email, Telegram, DM)…`);
for (let i = 0; ; i++) {
  const notes = (await agent(`/api/notifications?owner=${owner}`)) as { subject: string; channels: string[] }[];
  if (notes.some((n) => n.subject === "Check: Telegram")) break;
  if (i > 24) throw new Error("no Telegram check was sent");
  await sleep(5);
}
console.log(`\n>>> The Telegram check has been sent. Reply anything to the bot.\n`);

// 4: the reply cancels
const tQuiet = Date.now();
for (;;) {
  const s = await state();
  if (s === "Active") break;
  if (Date.now() - tQuiet > 10 * 60_000) throw new Error(`no reply within 10 minutes (state ${s})`);
  await sleep(3);
}
const sig = (await agent(`/api/signals/${owner}`)) as { observations: Record<string, { at: string }> };
console.log(`${at()} state: Active. The Telegram reply (seen at ${sig.observations.telegram?.at}) cancelled the escalation.`);
const w = (await view<{ executions: unknown[]; near_balance: string }>("get_will", { owner }))!;
if (w.executions.length) throw new Error("funds moved");
console.log(`\nDay A Telegram check passed on ${CONTRACT}: unarmed will stayed Active; armed will went Quiet; Telegram reply -> Active; vault untouched (${w.near_balance} yocto).`);
