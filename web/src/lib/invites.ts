"use client";
// Invite links (contract: will/invites.rs): the owner stores sha256(code) for a role; the link carries the
// code in its #fragment, so it never reaches a server log. Whoever opens it signs in and claims the role.
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { nameAccounts, nameOf } from "./names";
import { SITE_URL } from "./config";
import { call, nearToYocto, ROLE_TGAS, view } from "./near";

const PENDING = "inheirit:pending-invites";
type Pending = { owner: string; hash: string; role: InviteRole; name: string };
function pending(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING) ?? "[]") as Pending[];
  } catch {
    return [];
  }
}
function savePending(p: Pending[]) {
  try {
    localStorage.setItem(PENDING, JSON.stringify(p));
  } catch {
    // storage blocked: the new person just shows by account id
  }
}

/**
 * Names live in each browser, so the owner's browser remembers the name typed for each invite. Once an
 * invite is gone (claimed) and exactly one unnamed person has appeared in that role, they get that name.
 */
export async function nameClaimedInvites(owner: string, people: { role: InviteRole; account: string }[]): Promise<void> {
  const mine = pending().filter((p) => p.owner === owner);
  if (!mine.length) return;
  const keep: Pending[] = pending().filter((p) => p.owner !== owner);
  for (const p of mine) {
    const open = await inviteOpen(owner, "", p.hash).catch(() => ({ role: p.role, expires_at: 0 }));
    if (open) {
      keep.push(p);
      continue;
    }
    const fresh = people.filter((x) => x.role === p.role && !nameOf(x.account));
    if (fresh.length === 1 && p.name) nameAccounts({ [fresh[0].account]: p.name });
  }
  savePending(keep);
}

export type InviteRole = "guardian" | "friend" | "lawyer";
export const INVITE_TTL_S = 7 * 86_400;

export const codeHash = (code: string) => bytesToHex(sha256(new TextEncoder().encode(code)));

/** Creates an invite on-chain and returns the link to send (role and the person's name ride along). */
export async function createInvite(owner: string, role: InviteRole, name: string): Promise<string> {
  const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  await call(owner, "create_invite", { role, code_hash: codeHash(code), ttl_s: INVITE_TTL_S }, nearToYocto("0.01"));
  savePending([...pending(), { owner, hash: codeHash(code), role, name: name.trim() }]);
  return `${SITE_URL}/i/${code}`;
}

/** Which will an open invite belongs to, from the code alone (contract index `find_invite`). */
export async function findInvite(code: string): Promise<{ owner: string; role: string; expires_at: number } | null> {
  const r = await view<[string, { role: string; expires_at: number }] | null>("find_invite", { code_hash: codeHash(code) });
  return r ? { owner: r[0], ...r[1] } : null;
}

export async function inviteOpen(owner: string, code: string, hash = codeHash(code)): Promise<{ role: string; expires_at: number } | null> {
  return view("get_invite", { owner, code_hash: hash });
}

export async function claimInvite(account: string, owner: string, code: string): Promise<void> {
  await call(account, "claim_invite", { owner, code }, 0n, ROLE_TGAS);
}
