// Local-development copy of the will contract in local mode (requires_tee: false), so an agent running
// on a laptop can be whitelisted. inheirit.testnet itself is TEE-only (Decision log 2026-10-28).
// The account is created through the testnet faucet helper and owns itself; its key is a throwaway
// demo key in ~/.config/inheirit/demo-accounts.json.
//
//   npx tsx scripts/deploy-dev-contract.ts [agent_account_id]   create, deploy, init, whitelist
import fs from "node:fs";
import { KeyPair } from "@near-js/crypto";
import { saveKey } from "./demo-keys";
import { account, exists, provider, sleep } from "./lib/near";

const DEV = process.env.DEV_CONTRACT_ID || "inheirit-dev.testnet";
const WASM = "agent-contract/target/near/shade_contract_template.wasm";
const TGAS = 10n ** 12n;
// Local mode attests all-zero measurements and PPID (what `shade deploy` approves for local)
const ZERO_MEASUREMENTS = {
  rtmrs: { mrtd: "0".repeat(96), rtmr0: "0".repeat(96), rtmr1: "0".repeat(96), rtmr2: "0".repeat(96) },
  key_provider_event_digest: "0".repeat(96),
  app_compose_hash_payload: "0".repeat(64),
};

async function main() {
  const agentId = process.argv[2];
  if (!(await exists(DEV))) {
    const kp = KeyPair.fromRandom("ed25519");
    saveKey(DEV, kp.toString());
    const res = await fetch("https://helper.nearprotocol.com/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newAccountId: DEV, newAccountPublicKey: kp.getPublicKey().toString() }),
    });
    if (!res.ok) throw new Error(`Faucet helper failed: ${res.status} ${await res.text()}`);
    console.log(`created ${DEV} via faucet`);
    await sleep(3);
  }
  const dev = account(DEV);
  const state = await provider.viewAccount(DEV);
  if (state.code_hash === "11111111111111111111111111111111") {
    await dev.deployContract(new Uint8Array(fs.readFileSync(WASM)));
    await dev.callFunction({
      contractId: DEV,
      methodName: "new",
      args: { requires_tee: false, attestation_expiration_time_ms: "604800000", owner_id: DEV, mpc_contract_id: "v1.signer-prod.testnet" },
      gas: 30n * TGAS,
    });
    await dev.callFunction({ contractId: DEV, methodName: "approve_measurements", args: { measurements: ZERO_MEASUREMENTS }, gas: 30n * TGAS });
    await dev.callFunction({ contractId: DEV, methodName: "approve_ppids", args: { ppids: ["0".repeat(32)] }, gas: 30n * TGAS });
    console.log(`deployed and initialised ${DEV} (local mode)`);
  } else {
    console.log(`${DEV} already has code ${state.code_hash}`);
  }
  if (agentId) {
    await dev.callFunction({ contractId: DEV, methodName: "whitelist_agent_for_local", args: { account_id: agentId }, gas: 30n * TGAS });
    console.log(`whitelisted ${agentId}`);
  }
  const balance = Number((await provider.viewAccount(DEV)).amount) / 1e24;
  console.log(`${DEV}: ${balance.toFixed(3)} NEAR`);
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : e);
  process.exit(1);
});
