"use client";
// Sign-in without a NEAR wallet (CLAUDE.md §13A.1). The key pair is made here and only the public key
// goes to /api/onboard, which creates and funds the testnet account; the secret stays in this browser.
import { keys } from "./keys";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { createSubaccount, newKeyPair, provider } from "./near";
import { nameAccounts, randomPeople } from "./names";

export interface OnboardInfo {
  enabled: boolean;
  parent: string | null;
  googleClientId: string | null;
}

export async function onboardInfo(): Promise<OnboardInfo> {
  const res = await fetch("/api/onboard");
  if (!res.ok) return { enabled: false, parent: null, googleClientId: null };
  return res.json();
}

async function create(body: Record<string, string>, kp: KeyPair = newKeyPair()): Promise<{ accountId: string; existed: boolean }> {
  const res = await fetch("/api/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, publicKey: kp.getPublicKey().toString() }),
  });
  const out = await res.json().catch(() => ({ error: `Sign-up failed (${res.status})` }));
  if (!res.ok) throw new Error(out.error ?? `Sign-up failed (${res.status})`);
  if (!out.existed) keys.addAccount(out.accountId, kp.toString());
  return out;
}

/** "Try with a demo account": a fresh funded testnet account, no sign-in. */
export async function createDemoAccount(): Promise<string> {
  return (await create({ kind: "demo" })).accountId;
}

export interface GoogleKey {
  kp: KeyPair;
  /** sha256 of the public key, as hex. Google signs it into the ID token, so a leaked token can't create the account with someone else's key. */
  nonce: string;
}

/** The key pair for a Google sign-in, made before Google is asked, so its fingerprint can be the token's nonce. */
export async function googleKey(): Promise<GoogleKey> {
  const kp = newKeyPair();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kp.getPublicKey().toString()));
  return { kp, nonce: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("") };
}

/**
 * Google sign-in: the same Google account always maps to the same testnet account. We never hold
 * its key, so a second browser can only use it by restoring the backup key file.
 */
export async function signInWithGoogle(idToken: string, key: GoogleKey): Promise<string> {
  const { accountId, existed } = await create({ kind: "google", idToken }, key.kp);
  if (existed && !keys.secret(accountId)) {
    throw new Error(
      `Your Google account already has the testnet account ${accountId}, created in another browser. Restore it there from the key backup file (we never keep your key).`,
    );
  }
  return accountId;
}

/** Tops a nearly empty testnet account (e.g. a fresh wallet account) up to the onboarding amount. */
export async function topUpAccount(accountId: string): Promise<void> {
  const res = await fetch("/api/onboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "topup", accountId }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Top-up failed (${res.status})`);
}

/** Creates a test cast under the onboarding parent (for wallet owners); keys stay in this browser. */
export async function createCastAccounts(): Promise<Record<"heir" | "g1" | "g2" | "g3" | "friend" | "lawyer", string>> {
  const roles = ["heir", "g1", "g2", "g3", "friend", "lawyer"] as const;
  const pairs = Object.fromEntries(roles.map((r) => [r, newKeyPair()]));
  const res = await fetch("/api/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "cast", publicKeys: Object.fromEntries(roles.map((r) => [r, pairs[r].getPublicKey().toString()])) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Creating the cast failed (${res.status})`);
  for (const r of roles) keys.addAccount(out.accounts[r], pairs[r].toString());
  return out.accounts;
}

/**
 * A test person (heir, guardian, friend or lawyer) with a random first name, key in this browser. Made by
 * the owner when the owner's key is here, else by the onboarding route (wallets won't add full-access keys).
 */
export async function createPerson(owner: string): Promise<{ accountId: string; name: string }> {
  const [name] = randomPeople(1);
  let accountId: string;
  if (keys.secret(owner)) {
    accountId = await createSubaccount(owner, `p-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`, "0.1");
  } else {
    const kp = newKeyPair();
    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "person", publicKey: kp.getPublicKey().toString() }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `Creating the account failed (${res.status})`);
    accountId = out.accountId;
    keys.addAccount(accountId, kp.toString());
  }
  nameAccounts({ [accountId]: name });
  return { accountId, name };
}

/** Downloads the account's key so it can be restored in another browser. */
export function downloadKeyBackup(accountId: string): void {
  const secret = keys.secret(accountId);
  if (!secret) throw new Error(`This browser has no key for ${accountId}`);
  const blob = new Blob([JSON.stringify({ network: "testnet", account_id: accountId, private_key: secret }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `inheirit-testnet-${accountId}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Restores an account from a backup file made by downloadKeyBackup (or the same JSON shape). */
export async function restoreKeyBackup(file: File): Promise<string> {
  const j = JSON.parse(await file.text()) as { account_id?: string; private_key?: string };
  if (!j.account_id || !j.private_key?.startsWith("ed25519:")) throw new Error("That file isn't an Inheirit key backup");
  const pk = KeyPair.fromString(j.private_key as KeyPairString).getPublicKey().toString();
  const { keys: onChain } = await provider.viewAccessKeyList(j.account_id);
  if (!onChain.some((k) => k.public_key === pk)) throw new Error(`That key is not on ${j.account_id}`);
  keys.addAccount(j.account_id, j.private_key);
  return j.account_id;
}
