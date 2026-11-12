"use client";
// The owner's profile (round 5): their people (heirs, guardians, friends, lawyer) with contact details,
// the vault's name and a draft will. Saved with the agent, owner-signed, never on-chain; this browser keeps
// a copy so screens load instantly and work while the agent is restarting.
import { useEffect, useState } from "react";
import { agent, type AgentProfile } from "./agent";
import { keys } from "./keys";
import { nameOf } from "./names";
import { signRequest } from "./near";
import type { Will } from "./will";

export type Role = "heir" | "guardian" | "friend" | "lawyer";
export type Person = AgentProfile["people"][number];
export interface Profile {
  people: Person[];
  vaultName?: string;
  draft?: unknown;
  setupDone?: boolean;
}

export const ROLE_LABEL: Record<Role, string> = { heir: "Heir", guardian: "Guardian", friend: "Friend", lawyer: "Lawyer" };
const KEY = (owner: string) => `inheirit:profile:${owner}`;
const EVENT = "inheirit:profile";
const EMPTY: Profile = { people: [] };

export function localProfile(owner: string): Profile {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY(owner)) ?? "null") ?? {}) };
  } catch {
    return EMPTY;
  }
}

function writeLocal(owner: string, p: Profile) {
  try {
    localStorage.setItem(KEY(owner), JSON.stringify(p));
  } catch {
    // storage blocked: the agent copy is still saved
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: owner }));
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Saves a change here at once, then with the agent (signed). Throws if the agent refused it. */
export async function saveProfile(owner: string, patch: Partial<Profile>): Promise<Profile> {
  const next = { ...localProfile(owner), ...patch };
  writeLocal(owner, next);
  const data: Record<string, unknown> = {};
  if (patch.people) data.people = patch.people.map(clean);
  if (patch.vaultName !== undefined) data.vault_name = patch.vaultName;
  if ("draft" in patch) data.draft = patch.draft ?? null;
  if (patch.setupDone !== undefined) data.setup_done = patch.setupDone;
  await agent.saveProfile(await signRequest(owner, "profile", data));
  return next;
}

/** Only the fields the agent accepts, without empty strings. */
function clean(p: Person): Person {
  const out: Person = { id: p.id, name: p.name.trim().slice(0, 64) || "Someone", role: p.role };
  for (const k of ["account", "email", "telegram", "eth", "btc"] as const) if (p[k]?.trim()) out[k] = p[k]!.trim();
  return out;
}

/** The profile, kept in step across components. Fetched from the agent once if this browser has none
 * (and holds the key, so no wallet prompt just to read). */
export function useProfile(owner: string): [Profile, (patch: Partial<Profile>) => Promise<Profile>] {
  const [p, setP] = useState<Profile>(() => (owner ? localProfile(owner) : EMPTY));
  useEffect(() => {
    if (!owner) return;
    setP(localProfile(owner));
    const on = (e: Event) => (e as CustomEvent).detail === owner && setP(localProfile(owner));
    window.addEventListener(EVENT, on);
    if (!localStorage.getItem(KEY(owner)) && keys.secret(owner)) {
      signRequest(owner, "profile_read", {})
        .then((s) => agent.readProfile(s))
        .then((r) => r.profile && writeLocal(owner, { people: r.profile.people, vaultName: r.profile.vaultName, draft: r.profile.draft, setupDone: r.profile.setupDone }))
        .catch(() => {});
    }
    return () => window.removeEventListener(EVENT, on);
  }, [owner]);
  return [p, (patch) => saveProfile(owner, patch)];
}

/** Each person's role on the will (by account), or null if they aren't on it. */
export function roleOnWill(will: Will | null, account?: string): Role | null {
  if (!will || !account) return null;
  if (will.heirs.some((h) => h.account_id === account)) return "heir";
  if (will.guardians.some((g) => g.account_id === account)) return "guardian";
  if (will.lawyer === account) return "lawyer";
  if (will.contacts.includes(account)) return "friend";
  return null;
}

/** People on the will who aren't in the profile yet, as profile rows (so Profile lists everyone). */
export function missingFromProfile(will: Will | null, profile: Profile): Person[] {
  if (!will) return [];
  const known = new Set(profile.people.map((p) => p.account).filter(Boolean));
  const out: Person[] = [];
  const add = (account: string, role: Role, name?: string) => {
    if (known.has(account)) return;
    known.add(account);
    out.push({ id: newId(), name: name ?? nameOf(account) ?? account.split(".")[0], role, account });
  };
  will.heirs.forEach((h) => add(h.account_id, "heir", h.name));
  will.guardians.forEach((g) => add(g.account_id, "guardian"));
  if (will.lawyer) add(will.lawyer, "lawyer");
  will.contacts.forEach((c) => add(c, "friend"));
  return out;
}
