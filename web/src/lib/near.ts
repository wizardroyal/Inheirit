"use client";
import { boostPolling, shared } from "./boost";
import { Account } from "@near-js/accounts";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";
import { CONTRACT_ID, NEAR_RPC } from "./config";
import { keys } from "./keys";
import { walletAccountId, walletCall, walletSignMessage } from "./wallet";

export const provider = new JsonRpcProvider({ url: NEAR_RPC });
export const YOCTO = 10n ** 24n;
/** Gas for the small role calls (accept, attest, confirm, register a key): cast accounts hold little NEAR,
 *  and testnet reserves ~0.001 NEAR per Tgas up front, so the 100 Tgas default would need 0.1 NEAR each. */
export const ROLE_TGAS = 30n;
const TGAS = 10n ** 12n;

export function nearToYocto(near: number | string): bigint {
  const [whole, frac = ""] = String(near).split(".");
  return BigInt(whole || "0") * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

export function formatNear(yocto: string | bigint, digits = 4): string {
  const v = BigInt(yocto);
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export async function view<T>(methodName: string, args: Record<string, unknown> = {}, contractId = CONTRACT_ID): Promise<T> {
  // Components that show the same will share one RPC read.
  return shared(`view:${contractId}:${methodName}:${JSON.stringify(args)}`, async () => (await provider.callFunction(contractId, methodName, args)) as T);
}

export async function accountExists(id: string): Promise<boolean> {
  try {
    await provider.viewAccount(id);
    return true;
  } catch {
    return false;
  }
}

export async function balanceOf(id: string): Promise<bigint> {
  const a = await provider.viewAccount(id);
  return BigInt(a.amount);
}

export function account(accountId: string): Account {
  const secret = keys.secret(accountId);
  if (!secret) throw new Error(`This browser can't sign for ${accountId}. Sign in as that account, or restore its key backup.`);
  return new Account(accountId, provider, KeyPairSigner.fromSecretKey(secret as KeyPairString));
}

export interface CallResult<T = unknown> {
  hash: string;
  value: T;
}

/** True when this browser can sign for `accountId`: a key held here, or the wallet signed in as it. */
export function canSign(accountId: string): boolean {
  return !!keys.secret(accountId) || walletAccountId() === accountId;
}

/**
 * Calls the will contract as `accountId`: with the key held in this browser if there is one,
 * otherwise through the wallet signed in as that account (one approval in the wallet).
 */
export async function call<T = unknown>(accountId: string, methodName: string, args: Record<string, unknown> = {}, deposit = 0n, gasTgas = 100n): Promise<CallResult<T>> {
  return callMany<T>(accountId, [{ methodName, args, deposit, gasTgas }]);
}

/** Several calls to the will contract in one transaction (one wallet approval); returns the last call's value. */
export async function callMany<T = unknown>(
  accountId: string,
  calls: { methodName: string; args?: Record<string, unknown>; deposit?: bigint; gasTgas?: bigint }[],
): Promise<CallResult<T>> {
  const actions = calls.map((c) => ({ methodName: c.methodName, args: c.args ?? {}, deposit: c.deposit ?? 0n, gas: (c.gasTgas ?? 100n) * TGAS }));
  const outcome =
    !keys.secret(accountId) && walletAccountId() === accountId
      ? await walletCall(accountId, actions)
      : actions.length === 1
        ? await account(accountId).callFunctionRaw({ contractId: CONTRACT_ID, ...actions[0] })
        : await account(accountId).signAndSendTransaction({
            receiverId: CONTRACT_ID,
            actions: actions.map((a) => actionCreators.functionCall(a.methodName, a.args, a.gas, a.deposit)),
          });
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  if (status.Failure) throw new Error(failureMessage(status.Failure));
  const raw = status.SuccessValue ? atob(status.SuccessValue) : "";
  boostPolling(); // show the result of this transaction within seconds
  return { hash: outcome.transaction.hash as string, value: (raw ? JSON.parse(raw) : null) as T };
}

function failureMessage(f: unknown): string {
  const text = JSON.stringify(f);
  const m = text.match(/Smart contract panicked: ([^"\\]+)/);
  return m ? m[1] : text;
}

/** Plain contract panic text from a near-js error, for showing to people. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/Smart contract panicked: ([^"\\\n]+)/);
  if (m) return m[1];
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return "Couldn't reach the server. Check your connection and try again in a moment.";
  if (/NotEnoughBalance|LackBalanceForState|not enough balance/i.test(msg)) return "This account doesn't have enough testnet NEAR for that. Use “Get free testnet NEAR” on Your will.";
  if (/rejected|User closed|cancel/i.test(msg) && /wallet|user|request/i.test(msg)) return "The wallet request was cancelled.";
  return msg;
}

export interface SignedRequest {
  account_id: string;
  public_key: string;
  signature: string;
  nonce: string;
  message: string;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

/** NEP-413 message addressed to the will contract, as the agent's /api routes expect. */
export async function signRequest(accountId: string, action: "heartbeat" | "register_owner" | "draft_policy" | "heir_guide" | "demo_faucet" | "telegram_link" | "payout_pref" | "demo_signal", data?: unknown): Promise<SignedRequest> {
  const secret = keys.secret(accountId);
  const message = JSON.stringify({ action, owner: accountId, issued_at: Date.now(), data });
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  if (!secret) {
    if (walletAccountId() !== accountId) throw new Error(`This browser can't sign for ${accountId}. Sign in as that account, or restore its key backup.`);
    const w = await walletSignMessage(accountId, message, nonce);
    return { account_id: accountId, public_key: w.publicKey, signature: w.signature, nonce: b64(nonce), message };
  }
  const signed = await KeyPairSigner.fromSecretKey(secret as KeyPairString).signNep413Message(message, accountId, CONTRACT_ID, nonce);
  return { account_id: accountId, public_key: signed.publicKey.toString(), signature: b64(signed.signature), nonce: b64(nonce), message };
}

export function newKeyPair(): KeyPair {
  return KeyPair.fromRandom("ed25519");
}

export async function createSubaccount(funder: string, name: string, near: string): Promise<string> {
  return (await createSubaccounts(funder, [{ name, near }]))[0];
}

/**
 * Funded subaccounts of `funder` (whose key must be in this browser), keys kept here too. Wallets refuse
 * to add full-access keys to new accounts, so wallet owners get their cast from /api/onboard instead.
 */
export async function createSubaccounts(funder: string, specs: { name: string; near: string }[]): Promise<string[]> {
  const ids: string[] = [];
  for (const s of specs) {
    const id = `${s.name}.${funder}`;
    const kp = newKeyPair();
    await account(funder).createAccount(id, kp.getPublicKey(), nearToYocto(s.near));
    keys.addAccount(id, kp.toString());
    ids.push(id);
  }
  return ids;
}

/** A top-level testnet account funded by the public testnet faucet helper (CORS allows browsers). */
export async function createFaucetAccount(id: string): Promise<string> {
  const kp = newKeyPair();
  const res = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`Testnet faucet failed (${res.status}): ${await res.text()}`);
  keys.addAccount(id, kp.toString());
  for (let i = 0; i < 10 && !(await accountExists(id)); i++) await new Promise((r) => setTimeout(r, 1500));
  return id;
}
