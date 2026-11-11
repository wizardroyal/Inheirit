"use client";
// Demo tooling (CLAUDE.md §8 /demo): a throwaway cast of testnet accounts created in this browser,
// and a pre-seeded will with the compressed demo clock. Clearly demo-only.
import { nameAccounts, nameOf, randomPeople } from "./names";
import { checkPolicy, nearShareBps, policyHash, type Policy } from "@agent/policy/policy";
import { agent } from "./agent";
import { stagesFor, type SchedulePreset } from "@agent/policy/schedule";
import { keys, type Cast } from "./keys";
import { call, callMany, createSubaccount, createSubaccounts, nearToYocto, ROLE_TGAS, signRequest, view } from "./near";
import { createCastAccounts, createDemoAccount } from "./onboard";
import { sealToBase64 } from "./sealed";
import type { AgentKey } from "./will";

/**
 * Where the demo heir receives ETH and BTC when the agent has no demo faucet: testnet addresses whose
 * keys the project keeps (scripts/demo-keys.ts), so released test coins can be recycled. With a faucet,
 * the heir receives at the faucet pool's addresses instead, so coins flow back to the pool.
 */
export const DEMO_HEIR_RECEIVE = {
  eth: "0x5d1667ff79aB791eeE854D0D03c5598aF542A567",
  btc: "tb1qfgafnj3l9ql07w20gnu8rwenx3a2922pv6ynd4",
};

export const DEMO_NOTE = {
  label: "Where the hardware wallet is",
  text: "The Ledger is in the blue folder in the study. The PIN is with Aunt Ife.",
};

type Progress = (msg: string) => void;

/**
 * Creates a funder through our onboarding route (sponsored, so it doesn't depend on the public testnet
 * faucet, which rate-limits when many people use it at once), then the owner, heir, guardians and a
 * contact under it. The funder gets 1.5 NEAR; this spends about 1.3.
 */
export async function createCast(progress: Progress): Promise<Cast> {
  progress("Creating a funded testnet account…");
  const funder = await createDemoAccount();
  const sub = async (name: string, near: string) => {
    progress(`Creating ${name}.${funder}…`);
    return createSubaccount(funder, name, near);
  };
  const owner = await sub("alice", "0.9");
  const heir = await sub("bola", "0.08");
  const guardians = [await sub("g1", "0.08"), await sub("g2", "0.08"), await sub("g3", "0.08")];
  const contact = await sub("friend", "0.08");
  const cast: Cast = { funder, owner, heir, guardians, contact, createdAt: new Date().toISOString() };
  keys.addCast(cast);
  return cast;
}

export async function demoHeirReceive(): Promise<{ eth: string; btc: string }> {
  const f = await agent.faucetInfo().catch(() => ({ enabled: false as const }));
  return f.enabled ? { eth: f.eth, btc: f.btc } : DEMO_HEIR_RECEIVE;
}

export function demoPolicy(cast: Cast, receive: { eth: string; btc: string }, opts: { stable?: boolean } = {}): Policy {
  const check = checkPolicy({
    version: 1,
    owner: cast.owner,
    heirs: [{ id: "bola", name: "Bola", near_account: cast.heir, receive }],
    allocations: [
      { asset: "NEAR", shares: { bola: 100 } },
      { asset: "ETH", shares: { bola: 100 } },
      { asset: "BTC", shares: { bola: 100 } },
    ],
    stages_pct: [10, 20, 30, 40],
    guardians: cast.guardians,
    guardian_threshold: 2,
    ...(opts.stable ? { payout_value_mode: "stable" } : {}),
  });
  if (!check.ok) throw new Error(check.errors.join("; "));
  return check.policy;
}

export interface CreateWillOptions {
  policy: Policy;
  contacts: string[];
  /** Demo clock or real defaults; turns the policy's percentages into per-stage waits. */
  schedule: SchedulePreset;
  foreignChains: ("Eth" | "Btc")[];
  depositNear: string;
}

/** create_will + deposit, then hands the approved policy to the agent and asks it to watch (owner-signed). */
export async function createWill(owner: string, o: CreateWillOptions, progress: Progress): Promise<void> {
  const bps = nearShareBps(o.policy);
  const deposit = Number(o.depositNear) > 0 ? nearToYocto(o.depositNear) : 0n;
  progress(deposit ? `Creating the will on-chain and depositing ${o.depositNear} NEAR into the vault…` : "Creating the will on-chain…");
  // One transaction, so a wallet asks for one approval
  await callMany(owner, [
    {
      methodName: "create_will",
      args: {
        config: {
          heirs: o.policy.heirs.map((h) => ({ account_id: h.near_account, name: h.name, near_share_bps: bps[h.near_account] })),
          guardians: o.policy.guardians,
          guardian_threshold: o.policy.guardian_threshold,
          contacts: o.contacts,
          stages: stagesFor(o.policy.stages_pct, o.schedule),
          accelerated_stages: o.schedule.accelerated,
          timings: o.schedule.timings,
          policy_hash: policyHash(o.policy),
          foreign_chains: o.foreignChains,
          lawyer: o.policy.lawyer ?? null,
          heirs_hidden: true,
        },
      },
      deposit: nearToYocto("0.1"),
    },
    ...(deposit ? [{ methodName: "deposit_near", deposit }] : []),
  ]);
  progress("Giving the agent the approved will (it needs the heirs' receive addresses)…");
  await agent.submitPolicy(owner, o.policy);
  progress("Asking the agent to start watching for signs of life…");
  await agent.registerOwner(await signRequest(owner, "register_owner", {}));
}

/** Demo only: the cast's guardians (keys in this browser) accept their role, which arms the will. */
export async function acceptAsGuardians(owner: string, guardians: string[], progress: Progress): Promise<void> {
  for (const g of guardians) {
    progress(`${g} accepts the guardian role…`);
    await call(g, "accept_guardian", { owner }, 0n, ROLE_TGAS);
  }
}

/**
 * "Generate a will and cast for me" (CLAUDE.md §13A.1): an heir, three guardians, a friend and a lawyer as
 * subaccounts of the owner (keys in this browser, so one person can play every role), then a full will
 * with a sealed note. The guardians accept at once, so the will is armed.
 */
export async function generateWillAndCast(
  owner: string,
  o: { schedule: SchedulePreset; foreignChains: ("Eth" | "Btc")[]; depositNear: string; stable?: boolean },
  progress: Progress,
): Promise<Cast> {
  // Different people every time: names drawn from many cultures, shuffled per generation.
  const [heirName, ...others] = randomPeople(6);
  progress(`Creating the people in your will: ${heirName} (heir), guardians ${others.slice(0, 3).join(", ")}, ${others[3]} (friend) and ${others[4]} (lawyer)…`);
  // A wallet won't add full-access keys to new subaccounts, so a wallet owner's cast is made by the
  // onboarding route instead; an owner whose key is in this browser makes its own subaccounts.
  const [heir, g1, g2, g3, contact, lawyer] = !keys.secret(owner)
    ? await createCastAccounts().then((a) => [a.heir, a.g1, a.g2, a.g3, a.friend, a.lawyer])
    : await createSubaccounts(owner, [
    { name: "heir", near: "0.1" },
    { name: "g1", near: "0.1" },
    { name: "g2", near: "0.1" },
    { name: "g3", near: "0.1" },
    { name: "friend", near: "0.1" },
    { name: "lawyer", near: "0.1" },
  ]);
  const cast: Cast = { funder: owner, owner, heir, guardians: [g1, g2, g3], contact, lawyer, createdAt: new Date().toISOString() };
  keys.addCast(cast);
  nameAccounts({ [heir]: heirName, [g1]: others[0], [g2]: others[1], [g3]: others[2], [contact]: others[3], [lawyer]: others[4] });
  const receive = await demoHeirReceive();
  const check = checkPolicy({
    version: 1,
    owner,
    display_name: nameOf(owner) ?? owner.split(".")[0],
    heirs: [
      {
        id: "h1",
        name: heirName,
        near_account: heir,
        receive: { ...(o.foreignChains.includes("Eth") ? { eth: receive.eth } : {}), ...(o.foreignChains.includes("Btc") ? { btc: receive.btc } : {}) },
      },
    ],
    allocations: [
      { asset: "NEAR", shares: { h1: 100 } },
      ...(o.foreignChains.includes("Eth") ? [{ asset: "ETH", shares: { h1: 100 } }] : []),
      ...(o.foreignChains.includes("Btc") ? [{ asset: "BTC", shares: { h1: 100 } }] : []),
    ],
    stages_pct: [10, 20, 30, 40],
    guardians: cast.guardians,
    guardian_threshold: 2,
    contacts: [contact],
    lawyer,
    ...(o.stable ? { payout_value_mode: "stable" } : {}),
  });
  if (!check.ok) throw new Error(check.errors.join("; "));
  await createWill(owner, { policy: check.policy, contacts: [contact], schedule: o.schedule, foreignChains: o.foreignChains, depositNear: o.depositNear }, progress);
  await acceptAsGuardians(owner, cast.guardians, progress);
  progress(`Sealing a note for ${heirName} (released last)…`);
  await addSealedNote(owner, heir, DEMO_NOTE.label, DEMO_NOTE.text);
  if (o.foreignChains.length) {
    progress("Asking the demo faucet for a little Sepolia ETH and testnet BTC (while the pool lasts)…");
    await fundFromFaucet(owner, progress).catch((e) => progress(`The faucet couldn't help (${e instanceof Error ? e.message : e}). Those vaults stay empty; NEAR still moves for real.`));
  }
  return cast;
}

/** Seals a note in this browser to the agent's TEE key; only ciphertext goes on-chain. */
export async function addSealedNote(owner: string, heir: string, label: string, text: string): Promise<void> {
  const key = await view<AgentKey | null>("get_agent_pubkey");
  if (!key) throw new Error("The agent hasn't published its sealed-notes key yet, so notes can't be sealed. Try again in a minute.");
  const ciphertext = await sealToBase64(text, key.x25519_pubkey);
  await call(owner, "add_sealed_note", { heir, label, ciphertext }, nearToYocto("0.05"));
}

/** Asks the agent's demo faucet to fund the will's empty Sepolia/BTC vaults (signed by the owner). */
export async function fundFromFaucet(owner: string, progress: Progress): Promise<void> {
  const r = await agent.faucet(await signRequest(owner, "demo_faucet", {}));
  for (const s of r.sends) progress(`Faucet sent ${s.chain === "Eth" ? `${Number(s.amount) / 1e18} Sepolia ETH` : `${s.amount} testnet sats`} to the ${s.chain} vault (tx ${s.txHash.slice(0, 12)}…)`);
  for (const e of r.errors) progress(`The faucet couldn't fund a vault: ${e}`);
}
