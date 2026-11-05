// Day 3 checkpoint, headless: write the will in English → seal a note → execute → only the heir can
// decrypt it.
//  1. The agent drafts the policy from plain English with NEAR AI Cloud (attested model, signed
//     response) and returns a summary built by code; its hash goes on-chain in create_will.
//  2. The owner seals a note to the agent's published X25519 key (as the browser will).
//  3. The heir registers their own X25519 key from their NEAR account.
//  4. Silence → guardians attest → challenge → Executing; the agent re-seals the note to the heir.
//  5. The heir decrypts it; any other key fails.
// Requires the agent running in DEMO_MODE against the same contract (local: inheirit-dev.testnet).
//
// Usage: AGENT_CONTRACT_ID=inheirit-dev.testnet DEMO_OWNER=dora npx tsx scripts/demo-sealed-note.ts
import sodium from "libsodium-wrappers";
import { checkPolicy, policyHash, type Policy } from "../src/policy/policy";
import { keypairFromSeed, openSealed, sealTo, toHex } from "../src/sealed/crypto";
import { loadKeys, saveKey } from "./demo-keys";
import { acceptGuardians, call, CONTRACT, ensureSubaccount, NEAR, nearblocks, sleep, stateName, view, willConfig } from "./lib/near";

const AGENT = process.env.AGENT_URL || "http://localhost:3000";
const OWNER_NAME = process.env.DEMO_OWNER || "dora";
const NOTE = "The Ledger is in the blue folder in the study. The PIN is with Aunt Ife.";

async function agent(path: string, body?: unknown) {
  const res = await fetch(`${AGENT}${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  return { status: res.status, json };
}

const owner = await ensureSubaccount(OWNER_NAME, 1);
const heir = await ensureSubaccount("bola", 0.5);
const g1 = await ensureSubaccount("g1", 0.3);
const g2 = await ensureSubaccount("g2", 0.3);
console.log(`contract ${CONTRACT}, owner ${owner}, heir ${heir}`);

// 1. Plain English → policy
const english =
  `I leave all my NEAR to my son Bola, whose NEAR account is ${heir}. ` +
  `Release it in two stages, half and half. My guardians are ${g1} and ${g2}; both must confirm.`;
let policy: Policy;
let fromEnglish = false;
const att = await agent("/api/attestation/ai");
if (att.status === 200) {
  console.log(`NEAR AI model ${att.json.model} attested: ${att.json.ok} (${att.json.ok ? "all checks pass" : att.json.error})`);
  const draft = await agent("/api/policy/draft", { owner, text: english });
  if (draft.status !== 200 || !draft.json.ok) throw new Error(`policy draft failed: ${JSON.stringify(draft.json.errors ?? draft.json)}`);
  console.log(`Will in English: "${english}"`);
  console.log(`Response signature verified: ${draft.json.ai.signature.ok} (signer ${draft.json.ai.signature.signingAddress})`);
  console.log("Summary for the owner to approve:");
  for (const line of draft.json.summary as string[]) console.log(`  - ${line}`);
  policy = draft.json.policy;
  fromEnglish = true;
} else {
  console.log(`NEAR AI not configured on the agent (${att.json.error}); using a hand-written policy`);
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
  policy = check.policy;
}

if (await view("get_will", { owner })) throw new Error(`${owner} already has a will; use another DEMO_OWNER`);
const created = await call(owner, "create_will", { config: willConfig(policy, []) }, NEAR / 10n);
await acceptGuardians(owner, policy.guardians);
console.log(`create_will (policy_hash ${policyHash(policy).slice(0, 12)}…) ${nearblocks(created.hash)}`);
console.log(`deposit 0.2 NEAR ${nearblocks((await call(owner, "deposit_near", {}, NEAR / 5n)).hash)}`);

// 2. Seal a note to the agent's key
let agentKey: { x25519_pubkey: string; app_id: string } | null = null;
for (let i = 0; i < 12 && !agentKey; i++) {
  agentKey = await view("get_agent_pubkey", {});
  if (!agentKey) await sleep(5);
}
if (!agentKey) throw new Error("the agent has not published its sealed-notes key on this contract");
console.log(`agent sealed-notes key ${agentKey.x25519_pubkey.slice(0, 16)}… (app_id ${agentKey.app_id})`);
const ciphertext = Buffer.from(await sealTo(NOTE, agentKey.x25519_pubkey)).toString("base64");
const added = await call(owner, "add_sealed_note", { heir, label: "Where the Ledger is", ciphertext }, NEAR / 20n);
console.log(`sealed note added (${ciphertext.length} base64 chars on-chain, plaintext never sent) ${nearblocks(added.hash)}`);

// 3. Heir registers their own key (the browser keeps the secret; here it's a throwaway demo key)
await sodium.ready;
if (!loadKeys()["heir-x25519"]) saveKey("heir-x25519", Buffer.from(sodium.randombytes_buf(32)).toString("hex"));
const heirKp = await keypairFromSeed(Uint8Array.from(Buffer.from(loadKeys()["heir-x25519"], "hex")));
console.log(`heir registers key ${nearblocks((await call(heir, "register_heir_key", { owner, x25519_pubkey: toHex(heirKp.publicKey) })).hash)}`);

// 4. Silence → execution
await agent("/api/policy", { owner, policy });
const watching = await agent("/api/owners", { owner });
if (watching.status !== 200) throw new Error(`agent refused to watch ${owner}: ${JSON.stringify(watching.json)}`);
console.log("Owner goes silent; the agent escalates. Notes are released last: after all stages and the buffer (about 13 min)…");

const t0 = Date.now();
let last = "";
let attested = false;
while (Date.now() - t0 < 30 * 60_000) {
  const will = (await view<{ state: unknown }>("get_will", { owner }))!;
  const s = stateName(will.state)!;
  if (s !== last) {
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] state: ${s}`);
    last = s;
  }
  if (s === "GuardianVote" && !attested) {
    for (const g of [g1, g2]) console.log(`  ${g} attests Deceased ${nearblocks((await call(g, "attest", { owner, kind: "Deceased" })).hash)}`);
    attested = true;
  }
  const released = await view<{ note_id: number; label: string; ciphertext: string }[]>("get_released_notes", { owner, heir });
  if (released.length) {
    const ct = Buffer.from(released[0].ciphertext, "base64");
    const text = await openSealed(ct, heirKp);
    console.log(`\nReleased note "${released[0].label}" decrypted by the heir:\n  ${text}`);
    const stranger = await keypairFromSeed(Uint8Array.from(sodium.randombytes_buf(32)));
    const strangerFails = await openSealed(ct, stranger).then(() => false, () => true);
    console.log(`Another key can't open it: ${strangerFails}`);
    if (text !== NOTE || !strangerFails) throw new Error("sealed note check failed");
    const start = fromEnglish ? "English will (NEAR AI, attested + signed)" : "hand-written policy (NEAR AI not configured)";
    console.log(`\nPassed on ${CONTRACT}: ${start} → sealed note → execution → only the heir can decrypt.`);
    process.exit(0);
  }
  await sleep(10);
}
throw new Error("timed out before the note was released");
