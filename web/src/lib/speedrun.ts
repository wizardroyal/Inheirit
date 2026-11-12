"use client";
// "Set your will in motion" (CLAUDE.md §13A.1 item 5): the speedrun runs on the owner's own will. It
// switches the will to compressed (demo) timings with update_will, which keeps accepted guardians,
// heir keys and notes; afterwards the owner can switch back, or start over once the will is Completed.
import { nameOf } from "./names";
import { DEMO_SCHEDULE, REAL_SCHEDULE } from "./config";
import { agent } from "./agent";
import { keys } from "./keys";
import { call, nearToYocto, ROLE_TGAS, signRequest } from "./near";
import { keypairFromSeedHex, newSeedHex, pubkeyHex } from "./sealed";
import { stagesFor, type SchedulePreset } from "@agent/policy/schedule";
import type { Will } from "./will";

export type Scenario = "returns" | "full" | "accelerated" | "late-heir";

export const SCENARIOS: { id: Scenario; title: string; blurb: string }[] = [
  { id: "returns", title: "a · The owner comes back", blurb: "You go quiet; one sign of life snaps it back." },
  { id: "full", title: "b · The will is carried out", blurb: "Guardians confirm, 10 → 20 → 30 → 40% goes out, the heir opens a note." },
  { id: "accelerated", title: "c · A lawyer speeds it up", blurb: "A death certificate: 10 → 30 → 60%, shorter waits, challenge still runs." },
  { id: "late-heir", title: "d · The heir chooses late", blurb: "Slices wait until the heir picks a payout." },
];

/** A will on demo timings (it goes quiet after minutes, not days): a speedrun. Same rule as the agent's. */
export const isSpeedrun = (w: Will) => w.timings.quiet_after < 3600;

/** The will's current configuration, with `preset`'s timings and waits (same percentages and people). */
export function configFromWill(w: Will, preset: SchedulePreset) {
  return {
    heirs: w.heirs.map((h) => ({ account_id: h.account_id, name: h.name, near_share_bps: h.near_share_bps })),
    guardians: w.guardians.map((g) => g.account_id),
    guardian_threshold: w.guardian_threshold,
    contacts: w.contacts,
    stages: stagesFor(
      w.stages.map((s) => s.pct),
      preset,
    ),
    accelerated_stages: preset.accelerated,
    timings: preset.timings,
    policy_hash: w.policy_hash,
    foreign_chains: w.foreign_chains,
    lawyer: w.lawyer,
    heirs_hidden: w.heirs_hidden,
  };
}

/** Switches an Active will to demo timings (or back). Storage barely changes; the excess is refunded. */
export async function setTimings(w: Will, demo: boolean): Promise<void> {
  await call(w.owner, "update_will", { config: configFromWill(w, demo ? DEMO_SCHEDULE : REAL_SCHEDULE) }, nearToYocto("0.02"));
  // The agent stops watching a speedrun will after a few hours; switching timings starts it watching again.
  await agent.registerOwner(await signRequest(w.owner, "register_owner", {}));
}

/** Start over: a new will with the same people and percentages replaces a Completed one (contract rule). */
export async function startOver(w: Will, progress: (m: string) => void): Promise<void> {
  progress("Creating the will again with the same people and shares…");
  await call(w.owner, "create_will", { config: configFromWill(w, isSpeedrun(w) ? DEMO_SCHEDULE : REAL_SCHEDULE) }, nearToYocto("0.1"));
  for (const g of w.guardians.map((x) => x.account_id).filter((g) => keys.secret(g))) {
    progress(`${nameOf(g) ?? g.split(".")[0]} accepts the guardian role again…`);
    await call(g, "accept_guardian", { owner: w.owner }, 0n, ROLE_TGAS);
  }
  await agent.registerOwner(await signRequest(w.owner, "register_owner", {}));
}

/** The heir's X25519 key for sealed notes, kept in this browser; only the public half goes on-chain. */
export async function registerHeirKey(owner: string, heir: string): Promise<void> {
  const seed = keys.heirSeed(owner, heir) ?? (await newSeedHex());
  keys.setHeirSeed(owner, heir, seed);
  await call(heir, "register_heir_key", { owner, x25519_pubkey: await pubkeyHex(await keypairFromSeedHex(seed)) }, 0n, ROLE_TGAS);
}

export async function attestDeceased(guardian: string, owner: string): Promise<void> {
  await call(guardian, "attest", { owner, kind: "Deceased", evidence_hash: null }, 0n, ROLE_TGAS);
}

/** The lawyer's death proof. SIMULATED evidence: the fingerprint of a demo text, not a real certificate. */
export async function fileDeathProof(lawyer: string, owner: string): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`SIMULATED death certificate for ${owner} (Inheirit demo)`));
  const evidence_hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  await call(lawyer, "attest_death_proof", { owner, evidence_hash }, 0n, ROLE_TGAS);
}

/** A signed heartbeat from the owner: the strongest sign of life. */
export async function signOfLife(owner: string): Promise<void> {
  await agent.heartbeat(await signRequest(owner, "heartbeat", {}));
}
