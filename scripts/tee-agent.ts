// Manage the one long-lived TEE agent CVM on Phala Cloud (CLAUDE.md §7.5: provision once, upgrade in place).
// Credentials (Phala API key, contract owner key) come from the shade CLI keyring and are never printed,
// so the human runs this, not an automated tool.
//
//   npx tsx scripts/tee-agent.ts provision   create the CVM once; refuses if deploy/tee-agent.json exists
//   npx tsx scripts/tee-agent.ts approve     approve the running CVM's measurements + PPIDs on the contract
//   npx tsx scripts/tee-agent.ts upgrade     ship docker-compose.yaml + .env to the SAME CVM in place
//                                            (approves the new compose hash first, so the agent can register at boot)
//   npx tsx scripts/tee-agent.ts env         push .env (ENV_KEYS) to the CVM; changing the key list changes the
//                                            compose hash, which is approved before the restart
//   npx tsx scripts/tee-agent.ts retire <compose_hash>   remove an old version's approved measurements
//   npx tsx scripts/tee-agent.ts status      CVM status, app_id, compose hash, agent registration
//   npx tsx scripts/tee-agent.ts stop|start  pause billing; app_id and the sealed-notes key survive
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Account } from "@near-js/accounts";
import type { KeyPairString } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { rpcEndpoints } from "../src/config";

const APP_NAME = "inheirit-agent";
const DSTACK_VERSION = "0.5.12"; // CLI 2.4.0 only knows 0.5.7/0.5.8, which Phala no longer offers
const INSTANCE_TYPE = "tdx.small";
const COMPOSE = "./docker-compose.yaml";
// Part of the compose hash (allowed_envs): changing this list is a new measured version
const ENV_KEYS = ["AGENT_CONTRACT_ID", "SPONSOR_ACCOUNT_ID", "SPONSOR_PRIVATE_KEY", "DEMO_MODE", "NEARAI_API_KEY", "NEARAI_MODEL", "DEMO_FAUCET_ETH_KEY", "DEMO_FAUCET_BTC_KEY", "NEAR_RPC_URL"];
const RECORD = "deploy/tee-agent.json";
const PHALA_API = "https://cloud-api.phala.network/api/v1";
const CONTRACT = process.env.AGENT_CONTRACT_ID || "inheirit.testnet";
const provider = new JsonRpcProvider(rpcEndpoints(process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com")[0]);

interface Record {
  app_name: string;
  vm_uuid: string;
  app_id: string;
  dstack_version: string;
  instance_type: string;
  provisioned_at: string;
  upgrades?: { compose_hash: string; image: string; at: string }[];
}

interface Measurements {
  rtmrs: { mrtd: string; rtmr0: string; rtmr1: string; rtmr2: string };
  key_provider_event_digest: string;
  app_compose_hash_payload: string;
}

// Find the CLI through the `shade` binary: `npm root -g` points at whichever Node is active (nvm vs fnm),
// which may not be the one the CLI was installed under. SHADE_CLI_DIR overrides.
function shadeCliDir(): string {
  if (process.env.SHADE_CLI_DIR) return process.env.SHADE_CLI_DIR;
  const pkg = "@neardefi/shade-agent-cli";
  const candidates: string[] = [];
  try {
    let dir = path.dirname(fs.realpathSync(execSync("command -v shade", { shell: "/bin/sh" }).toString().trim()));
    while (dir !== path.dirname(dir) && !dir.endsWith("shade-agent-cli")) dir = path.dirname(dir);
    candidates.push(dir);
  } catch {
    // shade not on PATH in this shell
  }
  candidates.push(path.join(execSync("npm root -g").toString().trim(), pkg));
  const fnm = path.join(process.env.HOME ?? "", ".local/share/fnm/node-versions");
  if (fs.existsSync(fnm)) {
    for (const v of fs.readdirSync(fnm)) candidates.push(path.join(fnm, v, "installation/lib/node_modules", pkg));
  }
  const found = candidates.find((d) => fs.existsSync(path.join(d, "dist/src/utils/keystore.js")));
  if (!found) throw new Error(`Can't find ${pkg}; set SHADE_CLI_DIR to its install directory`);
  return found;
}
const cliDir = shadeCliDir();
const cliRoot = path.join(cliDir, "dist/src/utils");
const cli = async (mod: string) => import(path.join(cliRoot, mod));
const phalaCloud = async () => import(path.join(cliDir, "node_modules/@phala/cloud/dist/index.mjs"));

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

/** The CVM's current measurements, as reported in its tcb_info. */
async function currentMeasurements(apiKey: string, vmUuid: string): Promise<Measurements> {
  const att = await phalaGet(apiKey, `/cvms/${vmUuid}/attestation`);
  if (!att.tcb_info) throw new Error("No tcb_info yet; is the CVM running?");
  const tcb = typeof att.tcb_info === "string" ? JSON.parse(att.tcb_info) : att.tcb_info;
  const event = (name: string) => {
    const e = tcb.event_log.find((x: { event: string }) => x.event === name);
    if (!e) throw new Error(`event ${name} missing from event_log`);
    return e;
  };
  // Phala reports these; the backlog item is to recompute the OS measurements independently (dstack-mr).
  return {
    rtmrs: { mrtd: tcb.mrtd, rtmr0: tcb.rtmr0, rtmr1: tcb.rtmr1, rtmr2: tcb.rtmr2 },
    key_provider_event_digest: event("key-provider").digest,
    app_compose_hash_payload: event("compose-hash").event_payload,
  };
}

async function approveMeasurements(acct: Account, measurements: Measurements) {
  await acct.callFunction({ contractId: CONTRACT, methodName: "approve_measurements", args: { measurements }, gas: 30_000_000_000_000n });
  console.log(`approved measurements for compose hash ${measurements.app_compose_hash_payload}`);
}

async function approve() {
  const { vm_uuid } = readRecord();
  const apiKey = await phalaKey();
  const measurements = await currentMeasurements(apiKey, vm_uuid);

  const ppidsRes = await fetch(`${PHALA_API}/attestations/ppids`);
  const allPpids: string[] = await ppidsRes.json();
  // The contract's Ppid is HexBytes<16>; Phala's list includes "" and 64-byte entries that make approve_ppids panic
  const ppids = allPpids.filter((p) => /^[0-9a-f]{32}$/.test(p));

  const acct = await owner();
  await approveMeasurements(acct, measurements);
  await acct.callFunction({ contractId: CONTRACT, methodName: "approve_ppids", args: { ppids }, gas: 30_000_000_000_000n });
  const approved = (await provider.callFunction(CONTRACT, "get_approved_measurements", {})) as unknown[];
  console.log(`Approved on ${CONTRACT}: ${approved.length} measurement set(s), ${ppids.length} of ${allPpids.length} PPIDs`);
}

/**
 * In-place upgrade (§7.5): same CVM, same app_id, same sealed-notes key. Only the compose hash changes
 * (OS measurements and the key-provider digest stay), so the new hash is approved before the reboot.
 */
async function upgrade() {
  const record = readRecord();
  const compose = fs.readFileSync(COMPOSE, "utf8");
  if (compose.includes("IMAGE_DIGEST")) throw new Error(`${COMPOSE} still has the IMAGE_DIGEST placeholder`);
  const image = compose.match(/image:\s*(\S+)/)?.[1] ?? "?";
  const apiKey = await phalaKey();
  const { createClient } = await cli("phala-deploy.js");
  const { buildAppComposeForDeploy } = await cli("measurements.js");
  const client = createClient({ apiKey });

  const appCompose = buildAppComposeForDeploy(compose, ENV_KEYS, { publicLogs: true, publicSysinfo: true });
  const prov = await client.provisionCvmComposeFileUpdate({ id: record.vm_uuid, app_compose: appCompose });
  console.log(`provisioned compose hash ${prov.compose_hash} (image ${image})`);

  const current = await currentMeasurements(apiKey, record.vm_uuid);
  await approveMeasurements(await owner(), { ...current, app_compose_hash_payload: prov.compose_hash });

  const { envs, encryptedEnv } = await encryptedDotenv(client, record);
  await client.commitCvmComposeFileUpdate({
    id: record.vm_uuid,
    compose_hash: prov.compose_hash,
    encrypted_env: encryptedEnv,
    env_keys: envs.map((e) => e.key),
  });
  record.upgrades = [...(record.upgrades ?? []), { compose_hash: prov.compose_hash, image, at: new Date().toISOString() }];
  fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  console.log(`committed with env keys ${envs.map((e) => e.key).join(", ")}; the CVM reboots (~70 s).`);
  console.log(`Previous compose hash ${current.app_compose_hash_payload} stays approved until: npx tsx scripts/tee-agent.ts retire ${current.app_compose_hash_payload}`);
}

/** .env values for ENV_KEYS, encrypted to the CVM's env key (only the TEE can decrypt them). */
async function encryptedDotenv(client: any, record: Record): Promise<{ envs: { key: string; value: string }[]; encryptedEnv: string }> {
  const { parseEnvVars } = await cli("phala-deploy.js");
  const { encryptEnvVars } = await phalaCloud();
  const envs = (parseEnvVars(fs.readFileSync("./.env", "utf8")) as { key: string; value: string }[]).filter((e) => ENV_KEYS.includes(e.key));
  // Newer API versions nest the key under kms_info; fall back to asking the KMS for the app's key.
  const info = await client.getCvmInfo({ id: record.vm_uuid });
  let envPubkey: string | undefined = info.encrypted_env_pubkey ?? info.kms_info?.encrypted_env_pubkey ?? undefined;
  if (!envPubkey && info.kms_info?.slug) {
    envPubkey = (await client.getAppEnvEncryptPubKey({ app_id: record.app_id, kms: info.kms_info.slug })).public_key;
  }
  if (!envPubkey) throw new Error(`No env encryption key for the CVM (kms_type ${info.kms_type ?? "?"}); nothing committed`);
  return { envs, encryptedEnv: await encryptEnvVars(envs, envPubkey) };
}

/**
 * Phala keeps a CVM's allowed_envs on a compose update; changing the key list is a separate two-phase
 * env update. Phase 1 returns the new compose hash; we approve it on the contract, then confirm.
 */
async function pushEnv() {
  const record = readRecord();
  const apiKey = await phalaKey();
  const { createClient } = await cli("phala-deploy.js");
  const { updateCvmEnvs } = await phalaCloud();
  const client = createClient({ apiKey });
  const { envs, encryptedEnv } = await encryptedDotenv(client, record);
  const req = { id: record.vm_uuid, encrypted_env: encryptedEnv, env_keys: envs.map((e) => e.key) };

  let res = (await updateCvmEnvs(client, req, { schema: false })) as { status?: string; compose_hash?: string; correlation_id?: string };
  if (res.status === "precondition_required" && res.compose_hash) {
    console.log(`env keys change the compose hash to ${res.compose_hash}`);
    const current = await currentMeasurements(apiKey, record.vm_uuid);
    await approveMeasurements(await owner(), { ...current, app_compose_hash_payload: res.compose_hash });
    res = (await updateCvmEnvs(client, { ...req, compose_hash: res.compose_hash }, { schema: false })) as typeof res;
    record.upgrades = [...(record.upgrades ?? []), { compose_hash: res.compose_hash ?? "?", image: "(env keys update)", at: new Date().toISOString() }];
    fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  }
  console.log(`env update: ${JSON.stringify(res)}`);
  console.log(`keys: ${req.env_keys.join(", ")}. If the compose hash changed without a precondition, run approve after the restart.`);
}

async function retire(composeHash: string | undefined) {
  if (!composeHash) throw new Error("usage: retire <compose_hash>");
  const approved = (await provider.callFunction(CONTRACT, "get_approved_measurements", {})) as Measurements[];
  const target = approved.find((m) => m.app_compose_hash_payload === composeHash);
  if (!target) throw new Error(`no approved measurements with compose hash ${composeHash}`);
  await (await owner()).callFunction({ contractId: CONTRACT, methodName: "remove_measurements", args: { measurements: target }, gas: 30_000_000_000_000n });
  console.log(`removed measurements for ${composeHash}; ${approved.length - 1} set(s) remain`);
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
const run = {
  provision,
  approve,
  upgrade,
  env: pushEnv,
  retire: () => retire(process.argv[3]),
  status,
  stop: () => power("stopCvm"),
  start: () => power("startCvm"),
}[cmd ?? ""];
if (!run) {
  console.log("usage: npx tsx scripts/tee-agent.ts provision|approve|upgrade|env|retire <hash>|status|stop|start");
  process.exit(1);
}
run().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});
