// One command for docs/VERIFY.md: read-only checks that the agent runs in a TEE and only approved code
// can move money. No account, key or wallet needed.
// Usage: npx tsx scripts/verify.ts   (CONTRACT, NEAR_RPC and AGENT_URL override the defaults)
import fs from "node:fs";

const CONTRACT = process.env.CONTRACT || "inheirit.testnet";
const RPC = process.env.NEAR_RPC || "https://test.rpc.fastnear.com";
const AGENT = process.env.AGENT_URL || "https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network";

type Record = { app_id: string; upgrades: { compose_hash: string; image: string }[] };
const record: Record = JSON.parse(fs.readFileSync(new URL("../deploy/tee-agent.json", import.meta.url), "utf8"));
const latest = record.upgrades[record.upgrades.length - 1];

async function view<T>(method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  const j = (await res.json()) as { result?: { result: number[] }; error?: unknown };
  if (!j.result) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return JSON.parse(Buffer.from(j.result.result).toString());
}

let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const short = (h: string) => `${h.slice(0, 8)}…`;

console.log(`Verifying ${CONTRACT} (read-only)\n`);

// 1. Attested agents only
const info = await view<{ requires_tee: boolean }>("get_contract_info");
check(info.requires_tee === true, "1. the contract accepts only TEE-attested agents", `requires_tee: ${info.requires_tee}`);

// 2. Exactly one approved version, the one recorded in the repo
type Measurements = { app_compose_hash_payload: string };
const approved = await view<Measurements[]>("get_approved_measurements", {});
const hashes = approved.map((m) => m.app_compose_hash_payload).filter((h) => !/^0+$/.test(h));
check(hashes.length === 1, "2a. exactly one agent version is approved", hashes.map(short).join(", ") || "none");
check(hashes[0] === latest.compose_hash, "2b. it is the last version in deploy/tee-agent.json", `${short(latest.compose_hash)}`);
const compose = fs.readFileSync(new URL("../docker-compose.yaml", import.meta.url), "utf8");
check(compose.includes(latest.image), "2c. docker-compose.yaml pins that version's image", latest.image.split("@")[1]?.slice(0, 15) + "…");

// 3. The running agent is registered under that version
type AgentView = { account_id: string; measurements: Measurements; validity: unknown };
const agents = await view<AgentView[]>("get_agents", {});
const valid = agents.filter((a) => a.validity === "Valid");
check(valid.length > 0 && valid.every((a) => a.measurements.app_compose_hash_payload === latest.compose_hash), "3a. every valid agent runs the approved version", `${valid.length} valid of ${agents.length} ever registered`);
let live: { accountId: string; sealedNotes?: { x25519_pubkey: string; app_id: string; tee: boolean; enabled: boolean } } | null = null;
try {
  live = (await (await fetch(`${AGENT}/api/agent-info`, { signal: AbortSignal.timeout(15000) })).json()) as typeof live;
} catch {
  // the enclave may be paused
}
if (live) check(valid.some((a) => a.account_id === live!.accountId), "3b. the agent answering now is one of them", short(live.accountId));
else console.log("  SKIP  3b. the agent isn't answering (the enclave may be paused)");

// 4. The sealed-notes key belongs to the recorded enclave app
const key = await view<{ x25519_pubkey: string; app_id: string } | null>("get_agent_pubkey");
check(!!key && key.app_id === record.app_id, "4a. the sealed-notes key is bound to the recorded enclave app", key ? `app_id ${short(key.app_id)}` : "no key");
if (live?.sealedNotes) check(live.sealedNotes.tee && live.sealedNotes.enabled && live.sealedNotes.x25519_pubkey === key?.x25519_pubkey, "4b. the running agent derived that same key inside the TEE", short(live.sealedNotes.x25519_pubkey));

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
