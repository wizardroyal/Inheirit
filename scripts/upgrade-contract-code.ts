// Deploys new contract code over the existing state, without re-initialising (keeps every will).
// ONLY for changes that keep the storage layout (no new or changed fields in Contract or Will):
// otherwise the old state can't be deserialised. Layout changes need a fresh `shade deploy` instead.
//
//   npx tsx scripts/upgrade-contract-code.ts <contract_account> [owner_to_check]
// Key: SPONSOR_PRIVATE_KEY if it is a full-access key on the account (inheirit.testnet), else the
// demo key store (~/.config/inheirit/demo-accounts.json; inheirit-dev2.testnet).
import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { Account } from "@near-js/accounts";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { KeyPairSigner } from "@near-js/signers";
import bs58 from "bs58";
import { loadKeys } from "./demo-keys";
import { provider } from "./lib/near";

const WASM = "agent-contract/target/near/shade_contract_template.wasm";
const [contract, checkOwner] = process.argv.slice(2);
if (!contract) throw new Error("usage: upgrade-contract-code.ts <contract_account> [owner_to_check]");

const keys = (await provider.viewAccessKeyList(contract)).keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
const candidates = [process.env.SPONSOR_PRIVATE_KEY, loadKeys()[contract]].filter(Boolean) as string[];
const secret = candidates.find((s) => keys.includes(KeyPair.fromString(s as KeyPairString).getPublicKey().toString()));
if (!secret) throw new Error(`no full-access key for ${contract} in SPONSOR_PRIVATE_KEY or the demo key store`);

const code = fs.readFileSync(WASM);
const localHash = bs58.encode(createHash("sha256").update(code).digest());
const before = (await provider.viewAccount(contract)).code_hash;
console.log(`${contract}: code ${before} -> ${localHash} (${code.length} bytes)`);
if (before === localHash) process.exit(0);

const account = new Account(contract, provider, KeyPairSigner.fromSecretKey(secret as KeyPairString));
await account.deployContract(new Uint8Array(code));
const after = (await provider.viewAccount(contract)).code_hash;
if (after !== localHash) throw new Error(`deployed code hash ${after} does not match the build ${localHash}`);
console.log(`deployed; on-chain code hash ${after} matches the build`);
const info = await provider.callFunction(contract, "get_contract_info", {});
console.log("contract info still readable:", JSON.stringify(info));
if (checkOwner) {
  const will = (await provider.callFunction(contract, "get_will", { owner: checkOwner })) as { state: unknown } | null;
  console.log(`existing will of ${checkOwner} still readable:`, will ? JSON.stringify(will.state) : "none");
}
