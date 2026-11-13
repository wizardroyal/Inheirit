"use client";
// Sign-in without a NEAR wallet (CLAUDE.md §13A.1). The key pair is made here and only the public key
// goes to /api/onboard, which creates and funds the testnet account; the secret stays in this browser.
import { keys } from "./keys";
import { KeyPair } from "@near-js/crypto";
import { createSubaccount, newKeyPair } from "./near";
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
      "Your Google account is already set up in another browser. Open Inheirit there: its key lives only in that browser, and we never keep a copy.",
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
// One at a time: test people are made with the owner's key (or the parent's on the server), and two at
// once collide on the access key's nonce ("Transaction nonce … must be larger").
let personQueue: Promise<unknown> = Promise.resolve();
export function createPerson(owner: string, given?: string): Promise<{ accountId: string; name: string }> {
  const run = personQueue.then(() => createPersonNow(owner, given));
  personQueue = run.catch(() => {});
  return run;
}

async function createPersonNow(owner: string, given?: string): Promise<{ accountId: string; name: string }> {
  const name = given ?? randomPeople(1)[0];
  let accountId: string;
  if (keys.secret(owner)) {
    accountId = await createSubaccount(owner, `p-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`, "0.06");
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

