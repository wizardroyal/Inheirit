// v1 ONLY: kept as the record of the Day 1 checkpoint. The v2 contract (CLAUDE.md §5.5) rejects this
// config (stages_pct / stage_interval, no guardian acceptance); use demo-cancel.ts / demo-execute.ts.
// Day 1 checkpoint (CLAUDE.md §12): on testnet, walk wills through every state from the CLI.
//   Will A: Active -> Quiet -> WelfareCheck -> GuardianVote -> Challenge -> Executing{0}
//           -> owner calls i_am_alive -> Active (remaining stage halted, partial execution recorded)
//   Will B: same ladder, no sign of life -> Executing{0} -> Executing{1} -> Completed
// Timings are compressed for the demo (15 s periods). Uses throwaway demo accounts whose keys are
// kept outside the repo in ~/.config/inheirit/demo-accounts.json.
//
// Usage: node scripts/day1-walkthrough.mjs [A|B]   (default: both)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";

const CONTRACT = process.env.AGENT_CONTRACT_ID || "inheirit.testnet";
const FUNDER = process.env.DEMO_FUNDER_ACCOUNT || "inheirit-demo.testnet";
// rpc.testnet.near.org is deprecated and rate-limits (429) part-way through a run
const RPC = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
const KEY_FILE = path.join(os.homedir(), ".config", "inheirit", "demo-accounts.json");
const PERIOD = 15; // seconds
const NEAR = 10n ** 24n;
const POLICY_HASH = "0".repeat(63) + "1"; // placeholder; real policies come from the Day 3 parser

const provider = new JsonRpcProvider({ url: RPC });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const link = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;

function loadKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveKey(accountId, keyPair) {
  const keys = loadKeys();
  keys[accountId] = keyPair.toString();
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

function account(accountId) {
  const key = loadKeys()[accountId];
  if (!key) throw new Error(`No demo key for ${accountId} in ${KEY_FILE}`);
  return new Account(accountId, provider, KeyPairSigner.fromSecretKey(key));
}

async function exists(accountId) {
  try {
    await provider.viewAccount(accountId);
    return true;
  } catch {
    return false;
  }
}

/** Creates the funder via the testnet faucet helper (one-time; it receives faucet NEAR). */
async function ensureFunder() {
  if (await exists(FUNDER)) return;
  const kp = KeyPair.fromRandom("ed25519");
  saveKey(FUNDER, kp);
  const res = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: FUNDER, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`Faucet helper failed: ${res.status} ${await res.text()}`);
  console.log(`created ${FUNDER} via faucet`);
  await sleep(3);
}

async function ensureSubaccount(name, nearAmount) {
  const id = `${name}.${FUNDER}`;
  if (await exists(id)) return id;
  const kp = KeyPair.fromRandom("ed25519");
  saveKey(id, kp);
  await account(FUNDER).createAccount(id, kp.getPublicKey(), BigInt(Math.round(nearAmount * 1000)) * (NEAR / 1000n));
  console.log(`created ${id} with ${nearAmount} NEAR`);
  return id;
}

async function call(who, methodName, args = {}, deposit = 0n) {
  const outcome = await account(who).callFunctionRaw({
    contractId: CONTRACT,
    methodName,
    args,
    deposit,
    gas: 100n * 10n ** 12n,
  });
  const ok = outcome.status?.SuccessValue;
  const value = ok ? JSON.parse(Buffer.from(ok, "base64").toString() || "null") : null;
  return { hash: outcome.transaction.hash, value };
}

async function view(methodName, args) {
  return provider.callFunction(CONTRACT, methodName, args);
}

const stateName = (s) => (typeof s === "string" ? s : Object.keys(s ?? {})[0]);

async function state(owner) {
  return stateName(await view("get_state", { owner }));
}

/** Calls advance() until the will reaches `expected`; anyone may advance, here the owner's heir does. */
async function advanceTo(tag, caller, owner, expected) {
  for (let i = 0; i < 20; i++) {
    const { hash, value } = await call(caller, "advance", { owner });
    if (value) {
      const now = await state(owner);
      console.log(`[${tag}] advance -> ${now}   ${link(hash)}`);
      if (now !== expected) throw new Error(`[${tag}] expected ${expected}, got ${now}`);
      return;
    }
    await sleep(5);
  }
  throw new Error(`[${tag}] never reached ${expected}`);
}

function willConfig(heir, g1, g2) {
  return {
    heirs: [{ account_id: heir, name: "Bola", near_share_bps: 10000 }],
    guardians: [g1, g2],
    guardian_threshold: 2,
    contacts: [],
    stages_pct: [50, 50],
    timings: {
      quiet_after: PERIOD,
      nudge_period: PERIOD,
      welfare_period: PERIOD,
      vote_period: 300,
      challenge_period: PERIOD,
      stage_interval: PERIOD,
    },
    policy_hash: POLICY_HASH,
    foreign_chains: [], // NEAR only on Day 1; ETH/BTC vaults need the agent (Day 2)
  };
}

async function walk(tag, owner, heir, g1, g2, cancel) {
  console.log(`\n=== Will ${tag}: owner ${owner} ===`);
  let r = await call(owner, "create_will", { config: willConfig(heir, g1, g2) }, NEAR / 10n);
  console.log(`[${tag}] create_will -> ${await state(owner)}   ${link(r.hash)}`);
  r = await call(owner, "deposit_near", {}, NEAR);
  console.log(`[${tag}] deposit 1 NEAR   ${link(r.hash)}`);

  for (const s of ["Quiet", "WelfareCheck", "GuardianVote"]) await advanceTo(tag, heir, owner, s);
  for (const g of [g1, g2]) {
    r = await call(g, "attest", { owner, kind: "Deceased" });
    console.log(`[${tag}] ${g.split(".")[0]} attests Deceased -> ${await state(owner)}   ${link(r.hash)}`);
  }
  const heirBefore = await account(heir).getBalance();
  await advanceTo(tag, heir, owner, "Executing");
  await sleep(3);
  console.log(`[${tag}] heir received ${(Number((await account(heir).getBalance()) - heirBefore) / 1e24).toFixed(4)} NEAR (stage 0 = 50%, minus the heir's own advance gas)`);

  if (cancel) {
    r = await call(owner, "i_am_alive");
    const will = await view("get_will", { owner });
    console.log(`[${tag}] owner i_am_alive -> ${stateName(will.state)}   ${link(r.hash)}`);
    console.log(`[${tag}] halted at stage ${will.halted[0].stage}; vault keeps ${(Number(will.near_balance) / 1e24).toFixed(2)} NEAR`);
    if (stateName(will.state) !== "Active" || will.halted.length !== 1) throw new Error("cancel failed");
  } else {
    await advanceTo(tag, heir, owner, "Executing");
    await advanceTo(tag, heir, owner, "Completed");
    const will = await view("get_will", { owner });
    console.log(`[${tag}] vault left: ${will.near_balance} yocto; executions: ${will.executions.length}`);
  }
}

await ensureFunder();
const run = Date.now().toString(36).slice(-5);
const [heir, g1, g2] = [
  await ensureSubaccount("bola", 0.5),
  await ensureSubaccount("g1", 0.3),
  await ensureSubaccount("g2", 0.3),
];
const only = process.argv[2];
if (only !== "B") await walk("A", await ensureSubaccount(`alice-${run}`, 1.5), heir, g1, g2, true);
if (only !== "A") await walk("B", await ensureSubaccount(`bob-${run}`, 1.5), heir, g1, g2, false);
console.log(`\nDay 1 walkthrough passed (${only ?? "A and B"}).`);
