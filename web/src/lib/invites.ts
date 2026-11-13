"use client";
// Invite links (contract: will/invites.rs): the owner stores sha256(code) for a role; the link carries the
// code in its #fragment, so it never reaches a server log. Whoever opens it signs in and claims the role.
import { useEffect, useState } from "react";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { nameAccounts, nameOf } from "./names";
import { SITE_URL } from "./config";
import { call, nearToYocto, ROLE_TGAS, view } from "./near";

const PENDING = "inheirit:pending-invites";
type Pending = { owner: string; hash: string; role: InviteRole; name: string; link?: string; expires?: number };
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
  const gone = new Set<string>();
  for (const p of mine) {
    const open = await inviteOpen(owner, "", p.hash).catch(() => ({ role: p.role, expires_at: 0 }));
    if (open) continue;
    gone.add(p.hash);
    const fresh = people.filter((x) => x.role === p.role && !nameOf(x.account));
    if (fresh.length === 1 && p.name) nameAccounts({ [fresh[0].account]: p.name });
  }
  // Re-read: an invite made while we were checking must not be dropped.
  if (gone.size) savePending(pending().filter((p) => !(p.owner === owner && gone.has(p.hash))));
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
  const link = `${SITE_URL}/i/${code}`;
  savePending([...pending(), { owner, hash: codeHash(code), role, name: name.trim(), link, expires: Date.now() + INVITE_TTL_S * 1000 }]);
  window.dispatchEvent(new Event(PENDING_EVENT));
  return link;
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

const PENDING_EVENT = "inheirit:invites";

export type OpenInvite = { hash: string; role: InviteRole; name: string; link?: string };

/** Invites made in this browser that nobody has used yet (checked on-chain), with their links. */
export function useOpenInvites(owner: string): [OpenInvite[], () => void] {
  const [list, setList] = useState<OpenInvite[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const mine = pending().filter((p) => p.owner === owner && (!p.expires || p.expires > Date.now()));
    Promise.all(mine.map((p) => inviteOpen(owner, "", p.hash).then((o) => (o ? p : null)).catch(() => p))).then((r) => {
      if (live) setList(r.filter((x): x is Pending => !!x).map(({ hash, role, name, link }) => ({ hash, role, name, link })));
    });
    const on = () => setTick((t) => t + 1);
    window.addEventListener(PENDING_EVENT, on);
    return () => {
      live = false;
      window.removeEventListener(PENDING_EVENT, on);
    };
  }, [owner, tick]);
  return [list, () => setTick((t) => t + 1)];
}

/** Withdraws an unused invite (its storage goes back to the owner). */
export async function cancelInvite(owner: string, hash: string): Promise<void> {
  await call(owner, "cancel_invite", { code_hash: hash });
  savePending(pending().filter((p) => !(p.owner === owner && p.hash === hash)));
  window.dispatchEvent(new Event(PENDING_EVENT));
}
