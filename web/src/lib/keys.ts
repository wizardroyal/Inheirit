"use client";
// Keys held in this browser (localStorage). In the demo these are throwaway testnet accounts the
// demo panel creates; a real owner can also import a testnet key. Nothing here leaves the browser
// except signatures.
import { CONTRACT_ID } from "./config";

export interface Cast {
  funder: string;
  owner: string;
  heir: string;
  guardians: string[];
  contact: string;
  /** Set for casts generated for a signed-in owner (the funder is then the owner itself) */
  lawyer?: string;
  createdAt: string;
}

interface Saved {
  /** NEAR account -> "ed25519:…" secret key */
  near: Record<string, string>;
  /** "<owner>:<heir>" -> hex X25519 seed for sealed notes released to that heir */
  heirSeeds: Record<string, string>;
  casts: Cast[];
}

const KEY = `inheirit:${CONTRACT_ID}`;
const EMPTY: Saved = { near: {}, heirSeeds: {}, casts: [] };

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : structuredClone(EMPTY);
  } catch {
    return structuredClone(EMPTY);
  }
}

function save(s: Saved) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: keys live only for this page view
  }
  window.dispatchEvent(new Event("inheirit-keys"));
}

/** Called with each account whose key this browser just stored (near.ts waits for it to be on-chain). */
export const keyAdded: ((accountId: string) => void)[] = [];

export const keys = {
  accounts: () => Object.keys(load().near),
  secret: (accountId: string) => load().near[accountId] ?? null,
  addAccount(accountId: string, secret: string) {
    const s = load();
    s.near[accountId] = secret;
    save(s);
    for (const f of keyAdded) f(accountId);
  },
  heirSeed: (owner: string, heir: string) => load().heirSeeds[`${owner}:${heir}`] ?? null,
  setHeirSeed(owner: string, heir: string, seedHex: string) {
    const s = load();
    s.heirSeeds[`${owner}:${heir}`] = seedHex;
    save(s);
  },
  casts: () => load().casts,
  addCast(c: Cast) {
    const s = load();
    s.casts = [c, ...s.casts.filter((x) => x.owner !== c.owner)];
    save(s);
  },
};
