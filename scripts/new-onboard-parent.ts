// Creates the onboarding parent account (CLAUDE.md §13A.1): Google sign-in creates <id>.<parent> under it,
// so it holds onboarding funds only and never has a key on the will contract. Funded from the public
// testnet faucet: the parent gets one faucet grant, then each extra faucet account is deleted with the
// parent as beneficiary, which sweeps its balance across.
// Usage: npx tsx scripts/new-onboard-parent.ts [parent=inheirit-users.testnet] [extraGrants=2]
// Prints the env lines to put in .env and in the Vercel project (never commit them).
import { KeyPair } from "@near-js/crypto";
import { saveKey } from "./demo-keys";
import { account, exists, NEAR, provider, sleep } from "./lib/near";

const parent = process.argv[2] || "inheirit-users.testnet";
const extra = Number(process.argv[3] ?? "2");

async function faucetAccount(id: string, kp: KeyPair) {
  const res = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`Faucet helper failed for ${id}: ${res.status} ${await res.text()}`);
  saveKey(id, kp.toString());
  for (let i = 0; i < 15 && !(await exists(id)); i++) await sleep(2);
  if (!(await exists(id))) throw new Error(`${id} did not appear on-chain`);
}

async function balance(id: string): Promise<bigint> {
  return BigInt((await provider.viewAccount(id)).amount);
}

if (await exists(parent)) throw new Error(`${parent} already exists; pick another name or top it up instead`);
const parentKey = KeyPair.fromRandom("ed25519");
await faucetAccount(parent, parentKey);
console.error(`created ${parent}`);

for (let i = 0; i < extra; i++) {
  const id = `inheirit-sweep-${Math.random().toString(36).slice(2, 8)}.testnet`;
  await faucetAccount(id, KeyPair.fromRandom("ed25519"));
  await account(id).deleteAccount(parent);
  console.error(`swept ${id} into ${parent}`);
}

console.error(`${parent} balance: ${Number(await balance(parent)) / Number(NEAR)} NEAR`);
console.log(`ONBOARD_PARENT_ACCOUNT=${parent}`);
console.log(`ONBOARD_PARENT_KEY=${parentKey.toString()}`);
