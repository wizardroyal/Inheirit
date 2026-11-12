// Release schedules (CLAUDE.md §5.5). The policy states only percentages; the contract needs a
// wait after every slice. The first wait is the longest: the first slice leaving the vaults is
// the loudest alarm a living owner can get, so it gets the most time to react.
// Shared by the agent, the web app (via @agent/*) and the scripts.
import type { Stage, Timings } from "../near/will-contract";

const DAY = 86_400;

export interface SchedulePreset {
  timings: Timings;
  /** Wait after the first slice. */
  firstWait: number;
  /** Wait after every later slice (the last one leads into the secrets buffer). */
  wait: number;
  accelerated: Stage[];
}

export const STANDARD_PCT = [10, 20, 30, 40];

/** Compressed clock for the demo: seconds instead of days. */
export const DEMO_SCHEDULE: SchedulePreset = {
  timings: { quiet_after: 120, nudge_period: 60, welfare_period: 60, vote_period: 300, challenge_period: 120, secrets_buffer: 60 },
  firstWait: 180,
  wait: 60,
  accelerated: [10, 30, 60].map((pct) => ({ pct, wait_after: 60 })),
};

/**
 * Real defaults (round 5): a will shouldn't panic. Six months after the first slice, three months
 * between the rest, three months before secrets. The accelerated path covers urgent needs.
 */
export const REAL_SCHEDULE: SchedulePreset = {
  timings: {
    quiet_after: 30 * DAY,
    nudge_period: 7 * DAY,
    welfare_period: 14 * DAY,
    vote_period: 30 * DAY,
    challenge_period: 60 * DAY,
    secrets_buffer: 90 * DAY,
  },
  firstWait: 180 * DAY,
  wait: 90 * DAY,
  accelerated: [10, 30, 60].map((pct) => ({ pct, wait_after: 14 * DAY })),
};

/** The contract's standard schedule for the policy's percentages. */
export function stagesFor(stagesPct: number[], preset: SchedulePreset): Stage[] {
  return stagesPct.map((pct, i) => ({ pct, wait_after: i === 0 ? preset.firstWait : preset.wait }));
}

export interface ScheduleSummary {
  /** Silence until the first slice can move, if nobody answers and guardians vote at once. */
  earliestMove: number;
  /** Silence until the last slice has moved. */
  fullDistribution: number;
  /** Silence until sealed notes are released. */
  secrets: number;
}

/**
 * Durations for the setup summary ("If you go quiet, the earliest anything moves is ≈ X").
 * Assumes guardians reach quorum as soon as the vote opens; a slower vote only adds time.
 */
export function summarize(timings: Timings, stages: Stage[]): ScheduleSummary {
  const earliestMove = timings.quiet_after + timings.nudge_period + timings.welfare_period + timings.challenge_period;
  const waits = stages.slice(0, -1).reduce((s, st) => s + st.wait_after, 0);
  const fullDistribution = earliestMove + waits;
  const secrets = fullDistribution + (stages.at(-1)?.wait_after ?? 0) + timings.secrets_buffer;
  return { earliestMove, fullDistribution, secrets };
}
