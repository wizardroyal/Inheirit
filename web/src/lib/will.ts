// The will as get_will returns it (agent-contract/src/will/mod.rs), plus display helpers.
export type Chain = "Near" | "Eth" | "Btc";

export type WillState =
  | "Active"
  | { Quiet: { since: number } }
  | { WelfareCheck: { since: number } }
  | { GuardianVote: { since: number } }
  | { Challenge: { since: number } }
  | { Executing: { stage: number; since: number; stage_started: number } }
  | { Completed: { at: number } };

export type StateName = "Active" | "Quiet" | "WelfareCheck" | "GuardianVote" | "Challenge" | "Executing" | "Completed";

export interface Will {
  owner: string;
  heirs: { account_id: string; name: string; near_share_bps: number; x25519_pubkey: string | null }[];
  guardians: string[];
  guardian_threshold: number;
  contacts: string[];
  stages_pct: number[];
  timings: { quiet_after: number; nudge_period: number; welfare_period: number; vote_period: number; challenge_period: number; stage_interval: number };
  policy_hash: string;
  foreign_chains: Exclude<Chain, "Near">[];
  state: WillState;
  last_alive_at: number;
  created_at: number;
  attestations: { guardian: string; kind: "Deceased" | "Alive"; evidence_hash: string | null; at: number }[];
  sealed_notes: { id: number; heir: string; label: string; ciphertext: string; created_at: number }[];
  released_notes: { note_id: number; heir: string; label: string; ciphertext: string; at: number }[];
  near_balance: string;
  near_snapshot: string;
  pending_withdrawals: { id: number; chain: Chain; to: string; amount: string; created_at: number; signatures: number }[];
  execution_round: number;
  executions: { round: number; stage: number; chain: Chain; to: string; amount: string; tx_hash: string; at: number }[];
  stage_done: { stage: number; chain: Chain }[];
  halted: { round: number; stage: number; at: number; reason: string }[];
}

export interface AgentKey {
  x25519_pubkey: string;
  app_id: string;
  set_at: number;
}

export function stateName(s: WillState): StateName {
  return (typeof s === "string" ? s : Object.keys(s)[0]) as StateName;
}

/** When the current state began (seconds), or null for Active. */
export function stateSince(s: WillState): number | null {
  if (typeof s === "string") return null;
  const v = Object.values(s)[0] as { since?: number; at?: number };
  return v.since ?? v.at ?? null;
}

/** The escalation ladder, in order, with plain-language names. */
export const LADDER: { state: StateName; label: string; detail: string }[] = [
  { state: "Active", label: "All good", detail: "Normal signs of life seen. Nothing is asked of anyone." },
  { state: "Quiet", label: "Quiet", detail: "No signs of life for a while. The owner gets a gentle nudge." },
  { state: "WelfareCheck", label: "Welfare check", detail: "Trusted contacts are asked whether they've heard from the owner." },
  { state: "GuardianVote", label: "Guardian vote", detail: "Guardians are asked to confirm, with evidence. One 'alive' stops it." },
  { state: "Challenge", label: "Challenge period", detail: "Quorum reached. The owner is told on every channel; any activity cancels." },
  { state: "Executing", label: "Releasing in stages", detail: "Assets go out in slices. A sign of life halts the remaining stages." },
  { state: "Completed", label: "Completed", detail: "Everything has been released." },
];

/** Seconds until the next automatic step, given the current state and timings. */
export function nextStepIn(w: Will, nowS: number): { label: string; seconds: number } | null {
  const s = stateName(w.state);
  const since = stateSince(w.state);
  const t = w.timings;
  switch (s) {
    case "Active":
      return { label: "goes Quiet", seconds: w.last_alive_at + t.quiet_after - nowS };
    case "Quiet":
      return { label: "welfare check", seconds: since! + t.nudge_period - nowS };
    case "WelfareCheck":
      return { label: "guardian vote", seconds: since! + t.welfare_period - nowS };
    case "GuardianVote":
      return { label: "vote closes", seconds: since! + t.vote_period - nowS };
    case "Challenge":
      return { label: "execution starts", seconds: since! + t.challenge_period - nowS };
    case "Executing": {
      const e = (w.state as { Executing: { stage: number; stage_started: number } }).Executing;
      return { label: e.stage + 1 < w.stages_pct.length ? `stage ${e.stage + 2}` : "completes", seconds: e.stage_started + t.stage_interval - nowS };
    }
    default:
      return null;
  }
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s}s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

export function ago(iso: string | number): string {
  const ms = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  return `${duration((Date.now() - ms) / 1000)} ago`;
}

export const SOURCE_LABELS: Record<string, string> = {
  near_onchain: "NEAR transactions",
  evm_onchain: "Ethereum (Sepolia) transactions",
  phone_heartbeat: "Heartbeat app",
  github: "GitHub activity",
  google_calendar: "Google Calendar",
  gmail: "Gmail",
  x: "X posts",
  instagram: "Instagram posts",
};
