// NEAR helpers for demo scripts: throwaway demo accounts under DEMO_FUNDER_ACCOUNT whose keys live
// in ~/.config/inheirit/demo-accounts.json (outside the repo).
import { Account } from "@near-js/accounts";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { loadKeys, saveKey } from "../demo-keys";

export const CONTRACT = process.env.AGENT_CONTRACT_ID || "inheirit.testnet";
export const FUNDER = process.env.DEMO_FUNDER_ACCOUNT || "inheirit-demo.testnet";
// rpc.testnet.near.org is deprecated and rate-limits (429)
export const provider = new JsonRpcProvider({ url: (process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com").split(",")[0].trim() });
export const NEAR = 10n ** 24n;
export const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
export const nearblocks = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

export function account(id: string): Account {
  const key = loadKeys()[id];
  if (!key) throw new Error(`No demo key for ${id}`);
  return new Account(id, provider, KeyPairSigner.fromSecretKey(key as KeyPairString));
}

export async function exists(id: string): Promise<boolean> {
  try {
    await provider.viewAccount(id);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSubaccount(name: string, near: number): Promise<string> {
  const id = `${name}.${FUNDER}`;
  if (await exists(id)) return id;
  const kp = KeyPair.fromRandom("ed25519");
  saveKey(id, kp.toString());
  await account(FUNDER).createAccount(id, kp.getPublicKey(), (BigInt(Math.round(near * 1000)) * NEAR) / 1000n);
  console.log(`created ${id} with ${near} NEAR`);
  return id;
}

export async function call(who: string, methodName: string, args: Record<string, unknown> = {}, deposit = 0n) {
  const outcome = await account(who).callFunctionRaw({ contractId: CONTRACT, methodName, args, deposit, gas: 100n * 10n ** 12n });
  const ok = (outcome.status as { SuccessValue?: string }).SuccessValue;
  return { hash: outcome.transaction.hash as string, value: ok ? JSON.parse(Buffer.from(ok, "base64").toString() || "null") : null };
}

export async function view<T>(methodName: string, args: Record<string, unknown>): Promise<T> {
  return (await provider.callFunction(CONTRACT, methodName, args)) as T;
}

export const stateName = (s: unknown) => (typeof s === "string" ? s : Object.keys((s as object) ?? {})[0]);
