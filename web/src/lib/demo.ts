"use client";
// Demo tooling (CLAUDE.md §8 /demo): a throwaway cast of testnet accounts created in this browser,
// and a pre-seeded will with the compressed demo clock. Clearly demo-only.
import { checkPolicy, nearShareBps, policyHash, type Policy } from "@agent/policy/policy";
import { agent } from "./agent";
import { DEMO_TIMINGS } from "./config";
import { keys, type Cast } from "./keys";
import { call, createFaucetAccount, createSubaccount, nearToYocto, signRequest, view } from "./near";
import { sealToBase64 } from "./sealed";
import type { AgentKey } from "./will";

/**
 * Where the demo heir receives ETH and BTC. Testnet addresses whose keys the project keeps
 * (scripts/demo-keys.ts), so test coins released in demos can be recycled.
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

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Creates a funder from the testnet faucet, then the owner, heir, guardians and a contact under it. */
export async function createCast(progress: Progress): Promise<Cast> {
  const funder = `inheirit-${suffix()}.testnet`;
  progress(`Creating ${funder} from the testnet faucet…`);
  await createFaucetAccount(funder);
  const sub = async (name: string, near: string) => {
    progress(`Creating ${name}.${funder}…`);
    return createSubaccount(funder, name, near);
  };
  const owner = await sub("alice", "3");
  const heir = await sub("bola", "0.5");
  const guardians = [await sub("g1", "0.3"), await sub("g2", "0.3"), await sub("g3", "0.3")];
  const contact = await sub("friend", "0.2");
  const cast: Cast = { funder, owner, heir, guardians, contact, createdAt: new Date().toISOString() };
  keys.addCast(cast);
  return cast;
}

export function demoPolicy(cast: Cast): Policy {
  const check = checkPolicy({
    version: 1,
    owner: cast.owner,
    heirs: [{ id: "bola", name: "Bola", near_account: cast.heir, receive: DEMO_HEIR_RECEIVE }],
    allocations: [
      { asset: "NEAR", shares: { bola: 100 } },
      { asset: "ETH", shares: { bola: 100 } },
      { asset: "BTC", shares: { bola: 100 } },
    ],
    stages_pct: [10, 30, 60],
    guardians: cast.guardians,
    guardian_threshold: 2,
  });
  if (!check.ok) throw new Error(check.errors.join("; "));
  return check.policy;
}

export interface CreateWillOptions {
  policy: Policy;
  contacts: string[];
  timings: typeof DEMO_TIMINGS;
  foreignChains: ("Eth" | "Btc")[];
  depositNear: string;
}

/** create_will + deposit, then hands the approved policy to the agent and asks it to watch (owner-signed). */
export async function createWill(owner: string, o: CreateWillOptions, progress: Progress): Promise<void> {
  const bps = nearShareBps(o.policy);
  progress("Creating the will on-chain…");
  await call(
    owner,
    "create_will",
    {
      config: {
        heirs: o.policy.heirs.map((h) => ({ account_id: h.near_account, name: h.name, near_share_bps: bps[h.near_account] })),
        guardians: o.policy.guardians,
        guardian_threshold: o.policy.guardian_threshold,
        contacts: o.contacts,
        stages_pct: o.policy.stages_pct,
        timings: o.timings,
        policy_hash: policyHash(o.policy),
        foreign_chains: o.foreignChains,
      },
    },
    nearToYocto("0.1"),
  );
  if (Number(o.depositNear) > 0) {
    progress(`Depositing ${o.depositNear} NEAR into the NEAR vault…`);
    await call(owner, "deposit_near", {}, nearToYocto(o.depositNear));
  }
  progress("Giving the agent the approved policy…");
  await agent.submitPolicy(owner, o.policy);
  progress("Asking the agent to watch for signs of life (signed by the owner)…");
  await agent.registerOwner(await signRequest(owner, "register_owner", {}));
}

/** Seals a note in this browser to the agent's TEE key; only ciphertext goes on-chain. */
export async function addSealedNote(owner: string, heir: string, label: string, text: string): Promise<void> {
  const key = await view<AgentKey | null>("get_agent_pubkey");
  if (!key) throw new Error("The agent hasn't published its sealed-notes key on this contract yet");
  const ciphertext = await sealToBase64(text, key.x25519_pubkey);
  await call(owner, "add_sealed_note", { heir, label, ciphertext }, nearToYocto("0.05"));
}
