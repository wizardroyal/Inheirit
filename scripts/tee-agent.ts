// Manage the one long-lived TEE agent CVM on Phala Cloud (CLAUDE.md §7.5: provision once, upgrade in place).
// Credentials (Phala API key, contract owner key) come from the shade CLI keyring and are never printed,
// so the human runs this, not an automated tool.
//
//   npx tsx scripts/tee-agent.ts provision   create the CVM once; refuses if deploy/tee-agent.json exists
//   npx tsx scripts/tee-agent.ts approve     approve the running CVM's measurements + PPIDs on the contract
//   npx tsx scripts/tee-agent.ts status      CVM status, app_id, compose hash, agent registration
//   npx tsx scripts/tee-agent.ts stop|start  pause billing; app_id and the sealed-notes key survive
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Account } from "@near-js/accounts";
import type { KeyPairString } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";

const APP_NAME = "inheirit-agent";
const DSTACK_VERSION = "0.5.12"; // CLI 2.4.0 only knows 0.5.7/0.5.8, which Phala no longer offers
const INSTANCE_TYPE = "tdx.small";
const COMPOSE = "./docker-compose.yaml";
const ENV_KEYS = ["AGENT_CONTRACT_ID", "SPONSOR_ACCOUNT_ID", "SPONSOR_PRIVATE_KEY", "DEMO_MODE"];
const RECORD = "deploy/tee-agent.json";
const PHALA_API = "https://cloud-api.phala.network/api/v1";
const CONTRACT = process.env.AGENT_CONTRACT_ID || "inheirit.testnet";
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com" });

interface Record {
  app_name: string;
  vm_uuid: string;
  app_id: string;
  dstack_version: string;
  instance_type: string;
  provisioned_at: string;
}

const cliRoot = path.join(execSync("npm root -g").toString().trim(), "@neardefi/shade-agent-cli/dist/src/utils");
const cli = async (mod: string) => import(path.join(cliRoot, mod));

async function phalaKey(): Promise<string> {
  const key = await (await cli("keystore.js")).getPhalaKey();
  if (!key) throw new Error("No Phala API key in the shade CLI keyring (run `shade auth`)");
  return key;
}

async function phalaGet(apiKey: string, p: string) {
  const res = await fetch(`${PHALA_API}${p}`, { headers: { "X-API-Key": apiKey } });
  if (!res.ok) throw new Error(`Phala ${p}: ${res.status} ${await res.text()}`);
  // Some Phala responses contain raw newlines inside strings
  return JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, (c) => (c === "\n" ? "\\n" : "")));
}

function readRecord(): Record {
  if (!fs.existsSync(RECORD)) throw new Error(`${RECORD} not found; run provision first`);
  return JSON.parse(fs.readFileSync(RECORD, "utf8"));
}

async function owner(): Promise<Account> {
  const creds = await (await cli("keystore.js")).getNearCredentials("testnet");
  if (!creds) throw new Error("No testnet account in the shade CLI keyring");
  return new Account(creds.accountId, provider, KeyPairSigner.fromSecretKey(creds.privateKey as KeyPairString));
}

async function provision() {
  if (fs.existsSync(RECORD)) throw new Error(`${RECORD} exists: the agent CVM is provisioned once. Upgrade it in place instead.`);
  if (fs.readFileSync(COMPOSE, "utf8").includes("IMAGE_DIGEST")) throw new Error(`${COMPOSE} still has the IMAGE_DIGEST placeholder`);
  const apiKey = await phalaKey();
  const { deployToPhala, createClient } = await cli("phala-deploy.js");
  const existing = (await createClient({ apiKey }).getCvmList()).items ?? [];
  if (existing.some((c: { name: string }) => c.name === APP_NAME)) throw new Error(`A CVM named ${APP_NAME} already exists`);

  const res = await deployToPhala({
    appName: APP_NAME,
    apiKey,
    composePath: COMPOSE,
    envFilePath: "./.env",
    allowedEnvKeys: ENV_KEYS,
    dstackVersion: DSTACK_VERSION,
    instanceType: INSTANCE_TYPE,
    publicLogs: true,
    publicSysinfo: true,
  });
  const record: Record = {
    app_name: APP_NAME,
    vm_uuid: res.vm_uuid,
    app_id: res.app_id,
    dstack_version: DSTACK_VERSION,
    instance_type: INSTANCE_TYPE,
    provisioned_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  console.log(`Provisioned ${APP_NAME}: vm ${record.vm_uuid}, app_id ${record.app_id}`);
  console.log(`Dashboard: ${res.dashboard_url}`);
  console.log("Wait for it to boot (~2-3 min), then run: npx tsx scripts/tee-agent.ts approve");
}

async function approve() {
  const { vm_uuid } = readRecord();
  const apiKey = await phalaKey();
  const att = await phalaGet(apiKey, `/cvms/${vm_uuid}/attestation`);
  if (!att.tcb_info) throw new Error("No tcb_info yet; is the CVM running?");
  const tcb = typeof att.tcb_info === "string" ? JSON.parse(att.tcb_info) : att.tcb_info;
  const event = (name: string) => {
    const e = tcb.event_log.find((x: { event: string }) => x.event === name);
    if (!e) throw new Error(`event ${name} missing from event_log`);
    return e;
  };
  // Phala reports these; the backlog item is to recompute the OS measurements independently (dstack-mr).
  const measurements = {
    rtmrs: { mrtd: tcb.mrtd, rtmr0: tcb.rtmr0, rtmr1: tcb.rtmr1, rtmr2: tcb.rtmr2 },
    key_provider_event_digest: event("key-provider").digest,
    app_compose_hash_payload: event("compose-hash").event_payload,
  };
  console.log("compose hash:", measurements.app_compose_hash_payload);

  const ppidsRes = await fetch(`${PHALA_API}/attestations/ppids`);
  const allPpids: string[] = await ppidsRes.json();
  // The contract's Ppid is HexBytes<16>; Phala's list includes "" and 64-byte entries that make approve_ppids panic
  const ppids = allPpids.filter((p) => /^[0-9a-f]{32}$/.test(p));

  const acct = await owner();
  await acct.callFunction({ contractId: CONTRACT, methodName: "approve_measurements", args: { measurements }, gas: 30_000_000_000_000n });
  await acct.callFunction({ contractId: CONTRACT, methodName: "approve_ppids", args: { ppids }, gas: 30_000_000_000_000n });
  const approved = (await provider.callFunction(CONTRACT, "get_approved_measurements", {})) as unknown[];
  console.log(`Approved on ${CONTRACT}: ${approved.length} measurement set(s), ${ppids.length} of ${allPpids.length} PPIDs`);
}

async function status() {
  const rec = readRecord();
  const apiKey = await phalaKey();
  const info = await phalaGet(apiKey, `/cvms/${rec.vm_uuid}`);
  console.log(JSON.stringify({ name: info.name, status: info.status, app_id: rec.app_id, vm_uuid: rec.vm_uuid }, null, 2));
  const agents = (await provider.callFunction(CONTRACT, "get_agents", {})) as unknown[];
  console.log(`Registered agents on ${CONTRACT}:`, JSON.stringify(agents, null, 2));
}

async function power(action: "stopCvm" | "startCvm") {
  const { vm_uuid } = readRecord();
  const { createClient } = await cli("phala-deploy.js");
  await createClient({ apiKey: await phalaKey() })[action]({ id: vm_uuid });
  console.log(`${action} sent for ${vm_uuid}`);
}

const cmd = process.argv[2];
const run = { provision, approve, status, stop: () => power("stopCvm"), start: () => power("startCvm") }[cmd ?? ""];
if (!run) {
  console.log("usage: npx tsx scripts/tee-agent.ts provision|approve|status|stop|start");
  process.exit(1);
}
run().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});
