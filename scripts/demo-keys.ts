// Throwaway demo keys kept outside the repo in ~/.config/inheirit/demo-accounts.json (mode 600):
// NEAR demo accounts (see day1-walkthrough.mjs) and the demo heir's Sepolia and BTC testnet4
// receive keys, so test funds sent to the heir can be recycled instead of lost.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const KEY_FILE = path.join(os.homedir(), ".config", "inheirit", "demo-accounts.json");

export function loadKeys(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveKey(name: string, secret: string) {
  const keys = loadKeys();
  keys[name] = secret;
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

/** The demo heir's receive addresses, generating the keys on first use. */
export function demoHeirAddresses(): { eth: `0x${string}`; btc: string } {
  const keys = loadKeys();
  if (!keys["heir-eth"]) saveKey("heir-eth", generatePrivateKey());
  if (!keys["heir-btc"]) saveKey("heir-btc", Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex"));
  const k = loadKeys();
  const eth = privateKeyToAccount(k["heir-eth"] as `0x${string}`).address;
  const pubkey = Buffer.from(secp256k1.getPublicKey(Buffer.from(k["heir-btc"], "hex"), true));
  const btc = bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet }).address!;
  return { eth, btc };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(demoHeirAddresses(), null, 2));
}
