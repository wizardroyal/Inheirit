"use client";
// Sign-in without a NEAR wallet (CLAUDE.md §13A.1). The key pair is made here and only the public key
// goes to /api/onboard, which creates and funds the testnet account; the secret stays in this browser.
import { keys } from "./keys";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { newKeyPair, provider } from "./near";

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

async function create(body: Record<string, string>): Promise<{ accountId: string; existed: boolean }> {
  const kp = newKeyPair();
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

/**
 * Google sign-in: the same Google account always maps to the same testnet account. We never hold
 * its key, so a second browser can only use it by restoring the backup key file.
 */
export async function signInWithGoogle(idToken: string): Promise<string> {
  const { accountId, existed } = await create({ kind: "google", idToken });
  if (existed && !keys.secret(accountId)) {
    throw new Error(
      `Your Google account already has the testnet account ${accountId}, created in another browser. Restore it there from the key backup file (we never keep your key).`,
    );
  }
  return accountId;
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
