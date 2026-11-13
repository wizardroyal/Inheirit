"use client";
// Usernames (human request 2026-11-11): people who sign in get a random three-word name like
// "HatYoungRace" instead of seeing their testnet account id everywhere, and can rename themselves at any
// time. Kept in this browser only; the account id stays the on-chain identity.
import { useSyncExternalStore } from "react";

const KEY = "inheirit:names";
const EVENT = "inheirit-names";

const A = ["Bold", "Brave", "Calm", "Clever", "Quick", "Quiet", "Swift", "Young", "Wise", "Bright", "Lucky", "Steady", "Golden", "Silver", "Wild", "Gentle", "Noble", "Rapid", "Sunny", "Keen", "Loyal", "Mighty", "Proud", "Sharp", "True", "Warm", "Lively", "Plucky", "Witty", "Daring"];
const N = ["Hat", "River", "Falcon", "Maple", "Comet", "Harbor", "Lantern", "Meadow", "Otter", "Pine", "Quartz", "Raven", "Summit", "Tiger", "Willow", "Anchor", "Badger", "Cedar", "Ember", "Fox", "Glacier", "Heron", "Iris", "Juniper", "Kite", "Lynx", "Orchid", "Pebble", "Sparrow", "Thistle"];
const V = ["Race", "Dash", "Run", "Jump", "Climb", "Sprint", "Leap", "Drift", "Glide", "Stride", "Vault", "Swing", "Roll", "Spin", "Rally", "Surge", "Bloom", "Spark", "Quest", "March"];

const pick = <T,>(xs: T[]) => xs[crypto.getRandomValues(new Uint32Array(1))[0] % xs.length];

/** A random three-word name, e.g. "HatYoungRace". */
export function randomName(): string {
  return `${pick(N)} ${pick(A)} ${pick(V)}`;
}

/** Names made before 2026-11-13 were written together ("PineTrueSpin"); show every username one way. */
const spaced = (v: string) => (/^([A-Z][a-z]+){3}$/.test(v) ? v.replace(/([a-z])([A-Z])/g, "$1 $2") : v);

function load(): Record<string, string> {
  try {
    const m = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
    for (const k of Object.keys(m)) m[k] = spaced(m[k]);
    return m;
  } catch {
    return {};
  }
}

function save(m: Record<string, string>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // storage blocked: names last until the page reloads
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Gives a signed-in account a random name if it has none yet; returns its name. */
export function ensureName(account: string): string {
  const m = load();
  if (!m[account]) {
    m[account] = randomName();
    save(m);
  }
  return m[account];
}

const OWNERS = "inheirit:owners";

/** Remembers an account someone signed in as here, so "Continue as" lists owners, not the test people they made. */
export function rememberOwner(account: string): void {
  try {
    const list: string[] = JSON.parse(window.localStorage.getItem(OWNERS) ?? "[]");
    if (!list.includes(account)) window.localStorage.setItem(OWNERS, JSON.stringify([...list, account]));
  } catch {
    // storage blocked
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Accounts signed in as in this browser (newest last). */
export function useOwners(): string[] {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(OWNERS) ?? "[]";
      } catch {
        return "[]";
      }
    },
    () => "[]",
  );
  return JSON.parse(raw) as string[];
}

/** The account's username in this browser, if it has one (outside React). */
export function nameOf(account: string): string | undefined {
  return load()[account];
}

/** Renames an account (letters, digits, spaces, - and _; up to 32 characters). An empty name clears it. */
export function setName(account: string, name: string): void {
  const m = load();
  const clean = name.trim().replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 32);
  if (clean) m[account] = clean;
  else delete m[account];
  save(m);
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// First names for generated people (heirs, guardians, friends, lawyers), shuffled per generation.
const PEOPLE = [
  "Chiamaka", "Tobi", "Ngozi", "Emeka", "Funmi", "Kelechi", "Amara", "Seun", "Zainab", "Ifeoma",
  "Kwame", "Abena", "Wanjiru", "Thabo", "Fatou", "Moussa", "Amina", "Kofi", "Nia", "Jabari",
  "Sofia", "Lukas", "Elena", "Matteo", "Ingrid", "Pierre", "Anouk", "Mateusz", "Freya", "Pablo",
  "Olivia", "Ethan", "Maya", "Jordan", "Grace", "Caleb", "Harper", "Miles", "Ruby", "Theo",
  "Priya", "Arjun", "Mei", "Haruto", "Yuna", "Diego", "Lucía", "Rafael", "Leila", "Omar",
];

/** `n` different first names in random order, avoiding names already used in this browser while any remain. */
export function randomPeople(n: number): string[] {
  const used = new Set(Object.values(load()));
  const fresh = PEOPLE.filter((p) => !used.has(p));
  const pool = fresh.length >= n ? fresh : [...PEOPLE];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Names several accounts at once (generated people), without touching names already set. */
export function nameAccounts(names: Record<string, string>): void {
  const m = load();
  for (const [account, name] of Object.entries(names)) m[account] ??= name;
  save(m);
}

/**
 * What a person sees instead of a NEAR account id: the name this browser knows for it, else the account's
 * first label without ".testnet" ("alice.testnet" → "alice"; a 64-hex implicit account is shortened).
 * Agents and judges still see full ids in the technical details.
 */
export function accountLabel(id: string, names: Record<string, string>): string {
  if (names[id]) return names[id];
  const first = id.split(".")[0];
  return /^[0-9a-f]{64}$/.test(first) ? `${first.slice(0, 6)}…${first.slice(-4)}` : first;
}

// No lookbehind (Safari before 16.4 can't parse one): the preceding character is captured and kept.
const ACCOUNT_IN_TEXT = /(^|[^\w/.-])([a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.testnet)\b/g;

/** Replaces NEAR testnet account ids in a sentence with what a person sees (links are left alone). */
export function humanize(text: string, names: Record<string, string>): string {
  return text.replace(ACCOUNT_IN_TEXT, (_, before: string, id: string) => before + accountLabel(id, names));
}

/** `label(id)` for the accounts on a page, re-rendering when a name changes. */
export function useAccountLabel(): (id: string) => string {
  const names = useNames();
  return (id: string) => accountLabel(id, names);
}

/** Every name in this browser, re-rendering when one changes. */
export function useNames(): Record<string, string> {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(KEY) ?? "{}";
      } catch {
        return "{}";
      }
    },
    () => "{}",
  );
  const m = JSON.parse(raw) as Record<string, string>;
  for (const k of Object.keys(m)) m[k] = spaced(m[k]);
  return m;
}


/** A summary line for people: account ids as names, a name said once, long addresses shortened. */
export function readable(text: string, names: Record<string, string>): string {
  return humanize(text, names)
    .replace(/([^\s(]+) \(\1\)/g, "$1")
    .replace(/\b(0x[0-9a-fA-F]{4})[0-9a-fA-F]{32}([0-9a-fA-F]{4})\b/g, "$1…$2")
    .replace(/\b(tb1[a-z0-9]{4})[a-z0-9]{20,}([a-z0-9]{4})\b/g, "$1…$2");
}
