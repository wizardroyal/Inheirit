// Creates a fresh demo funder from the public testnet faucet (the long-lived inheirit-demo.testnet runs
// dry after many demos). Its key goes to ~/.config/inheirit/demo-accounts.json; use it with
//   DEMO_FUNDER_ACCOUNT=<printed id> npx tsx scripts/demo-cancel.ts
// Usage: npx tsx scripts/new-funder.ts
import { KeyPair } from "@near-js/crypto";
import { saveKey } from "./demo-keys";
import { exists, sleep } from "./lib/near";

const id = `inheirit-fund-${Math.random().toString(36).slice(2, 8)}.testnet`;
const kp = KeyPair.fromRandom("ed25519");
const res = await fetch("https://helper.nearprotocol.com/account", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
});
if (!res.ok) throw new Error(`Faucet helper failed: ${res.status} ${await res.text()}`);
saveKey(id, kp.toString());
for (let i = 0; i < 10 && !(await exists(id)); i++) await sleep(2);
console.log(id);
