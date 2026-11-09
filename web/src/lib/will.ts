// The will as get_will returns it (agent-contract/src/will/mod.rs), plus display helpers.
export type Chain = "Near" | "Eth" | "Btc";

export type WillState =
  | "Active"
  | { Quiet: { since: number } }
  | { WelfareCheck: { since: number } }
  | { GuardianVote: { since: number } }
  | { Challenge: { since: number } }
  | { Executing: { stage: number; since: number; stage_started: number } }
  | { SecretsBuffer: { since: number } }
  | { SecretsReleased: { since: number } }
  | { Completed: { at: number } };

export type StateName =
  | "Active"
  | "Quiet"
  | "WelfareCheck"
  | "GuardianVote"
  | "Challenge"
  | "Executing"
  | "SecretsBuffer"
  | "SecretsReleased"
  | "Completed";

export interface Stage {
  pct: number;
  wait_after: number;
}

export interface Will {
  owner: string;
  heirs: { account_id: string; name: string; near_share_bps: number; x25519_pubkey: string | null }[];
  guardians: { account_id: string; accepted: boolean }[];
  guardian_threshold: number;
  contacts: string[];
  stages: Stage[];
  accelerated_stages: Stage[];
  /** Schedule of the current (or last) execution round; empty before the first. */
  round_stages: Stage[];
  timings: { quiet_after: number; nudge_period: number; welfare_period: number; vote_period: number; challenge_period: number; secrets_buffer: number };
  policy_hash: string;
  foreign_chains: Exclude<Chain, "Near">[];
  lawyer: string | null;
  heirs_hidden: boolean;
  accelerated: boolean;
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

/** The schedule that applies now: the round's snapshot once execution has started. */
export function schedule(w: Will): Stage[] {
  return w.round_stages.length ? w.round_stages : w.stages;
}

export const guardianIds = (w: Will) => w.guardians.map((g) => g.account_id);
export const acceptedGuardians = (w: Will) => w.guardians.filter((g) => g.accepted).map((g) => g.account_id);
export const isArmed = (w: Will) => acceptedGuardians(w).length >= w.guardian_threshold && w.heirs.length > 0;

/** Funds may already have moved (heirs are no longer hidden from then on). */
export function executionStarted(s: WillState): boolean {
  return ["Executing", "SecretsBuffer", "SecretsReleased", "Completed"].includes(stateName(s));
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
  { state: "Executing", label: "Releasing in stages", detail: "Assets go out in slices, the longest wait after the first. A sign of life halts the rest." },
  { state: "SecretsBuffer", label: "Waiting before secrets", detail: "Everything is distributed. Sealed notes wait out a buffer; a sign of life still stops them." },
  { state: "SecretsReleased", label: "Secrets released", detail: "Sealed notes are re-sealed to each heir, who opens them in the browser." },
  { state: "Completed", label: "Completed", detail: "Everything has been released." },
];

/** Plain-language name of a state, as the ladder shows it. */
export const stateLabel = (s: StateName): string => LADDER.find((l) => l.state === s)?.label ?? s;

/** Seconds until the next automatic step, given the current state and timings. */
export function nextStepIn(w: Will, nowS: number): { label: string; seconds: number } | null {
  const s = stateName(w.state);
  const since = stateSince(w.state);
  const t = w.timings;
  switch (s) {
    case "Active":
      if (!isArmed(w)) return null; // an unarmed will never escalates
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
      const st = schedule(w);
      return { label: e.stage + 1 < st.length ? `stage ${e.stage + 2}` : "secrets buffer", seconds: e.stage_started + st[e.stage].wait_after - nowS };
    }
    case "SecretsBuffer":
      return { label: "secrets released", seconds: since! + t.secrets_buffer - nowS };
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
  telegram: "Telegram replies",
  x: "X posts",
  instagram: "Instagram posts",
  tiktok: "TikTok posts",
  facebook: "Facebook posts",
  whatsapp: "WhatsApp replies",
  linkedin: "LinkedIn activity",
};
