"use client";
// The hero "Signs of life" panel (CLAUDE.md §8): live strips per source that pulse when a signal lands,
// the ladder as a horizontal progress bar with a countdown, a visible snap back to Active when a sign
// of life cancels an escalation, the agent's plain-English verdict, and what the agent can see.
import { humanize, useNames } from "@/lib/names";
import { useEffect, useRef, useState } from "react";
import { useNow, useOverview } from "@/lib/hooks";
import { duration, isArmed, LADDER, nextStepIn, stateName, type StateName, type Will } from "@/lib/will";
import { AgentBadge, AiBadge } from "./Attestation";
import { Pill, SimulatedTag } from "./ui";
import { SOURCES, strength } from "./WillParts";
import { SOURCE_LABELS, ago } from "@/lib/will";

export function SignsOfLife({ owner, will }: { owner: string; will: Will }) {
  const now = useNow();
  const state = stateName(will.state);
  const { data: overview, error: agentDown, refresh } = useOverview(owner);
  const names = useNames();
  const data = overview?.signals;
  // Refetch as soon as the state changes, so the verdict never describes the previous state for long.
  useEffect(() => {
    refresh();
  }, [state, refresh]);
  const snapped = useSnapBack(state, will.last_alive_at);
  const movedThisRound = will.executions.some((e) => e.round === will.execution_round);
  const pulsing = usePulses(data?.observations);
  const idx = LADDER.findIndex((r) => r.state === state);
  const next = nextStepIn(will, now);
  const seen = SOURCES.filter((s) => data?.observations[s.source]);
  const unseen = SOURCES.filter((s) => !data?.observations[s.source] && !s.simulated);

  return (
    <section id="signs-of-life" key={snapped || undefined} className={`scroll-mt-4 space-y-4 rounded-2xl border border-line bg-card p-6 ${snapped ? "snap-wash" : ""}`} aria-label="Signs of life">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl">Signs of life</h2>
        {!isArmed(will) && <Pill tone="warn">not armed yet: guardians haven&apos;t accepted</Pill>}
      </div>

      {/* The ladder: one strip of segments (names on hover or tap), the current step written out, and the
          full list on request. No row of nine labels: they can't fit at every width or zoom. */}
      <div>
        <ol className="flex gap-1" aria-label={`Step ${Math.max(idx, 0) + 1} of ${LADDER.length}`}>
          {LADDER.map((r, i) => (
            <li
              key={r.state}
              title={r.label}
              className={`h-2.5 flex-1 rounded-full transition-colors duration-700 ${i < idx ? "bg-accent" : i === idx ? "bg-accent ring-2 ring-accent/40 ring-offset-1 ring-offset-card" : "bg-line"}`}
            >
              <span className="sr-only">
                {r.label}
                {i === idx ? " (now)" : i < idx ? " (done)" : ""}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm text-muted">
            Step {Math.max(idx, 0) + 1} of {LADDER.length}
          </span>
          <span className="text-xl font-semibold">{LADDER[idx]?.label ?? state}</span>
          {next && (
            <span className="text-muted">
              {next.seconds > 0 ? (
                <>
                  next: {next.label} in <span className="font-medium tabular-nums text-ink">{duration(next.seconds)}</span>
                </>
              ) : (
                <>next: {next.label}, due now</>
              )}
            </span>
          )}
          {snapped > 0 && (
            <span key={snapped} className="snap-flash rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-ink">
              Sign of life: back to All good
            </span>
          )}
        </div>
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-muted hover:text-ink">See all steps</summary>
          <ol className="mt-1 space-y-1">
            {LADDER.map((r, i) => (
              <li key={r.state} className={`flex items-center gap-3 ${i === idx ? "font-semibold" : i > idx ? "text-muted" : ""}`}>
                <span aria-hidden className={`w-4 text-center ${i <= idx ? "text-accent" : ""}`}>
                  {i < idx ? "✓" : i === idx ? "●" : "○"}
                </span>
                {r.label}
              </li>
            ))}
          </ol>
        </details>
      </div>

      {agentDown && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
          The agent isn&apos;t answering (paused or restarting). Nothing moves until it&apos;s back; your will is safe on-chain.
        </p>
      )}

      {/* Verdict */}
      {data?.verdict && (
        <div className="rounded-lg bg-accent-soft px-4 py-3" role="status" aria-live="polite">
          {/* The agent's verdict can trail the chain by a poll; at the snap-back, say what just happened. */}
          <p className="font-medium">{snapped > 0
              ? movedThisRound
                ? "Sign of life recorded. Remaining stages and notes stopped."
                : "Sign of life recorded. Cancelled; nothing moved."
              : humanize(data.verdict.headline, names)}</p>
          {data.verdict.details.map((d) => (
            <p key={d} className="mt-1 text-sm text-muted">
              {humanize(d, names)}
            </p>
          ))}
        </div>
      )}

      {/* One strip per source */}
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {seen.map((s) => {
          const at = data!.observations[s.source]!.at;
          const st = strength(s.weight);
          return (
            <li key={`${s.source}-${pulsing[s.source] ?? 0}`} className="rounded-lg border border-line px-3 py-2">
              <span className="flex items-center gap-2 font-medium">
                <span className={`h-2 w-2 shrink-0 rounded-full ${st.label === "weak" ? "bg-muted" : "bg-accent"}`} aria-hidden />
                {SOURCE_LABELS[s.source]}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 pl-4 text-xs text-muted">
                <Pill tone={st.tone}>{st.label}</Pill>
                {s.simulated && <SimulatedTag />}
                <span>{ago(at)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {unseen.length > 0 && (
        <p className="text-xs text-muted">Not seen yet: {unseen.map((s) => SOURCE_LABELS[s.source]).join(", ")}.</p>
      )}

      {/* Privacy strip */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-muted">
        <span>
          <span className="font-medium text-ink">What the agent saw: timestamps only.</span> It runs in a TEE and never stores content.
        </span>
        <AgentBadge />
        <AiBadge />
      </div>
    </section>
  );
}

/**
 * Returns a changing key for a few seconds after a sign of life brings an escalating will back to
 * Active. An expired guardian vote also returns to Active, but without a new sign of life
 * (last_alive_at unchanged), so it does not snap back.
 */
function useSnapBack(state: StateName, lastAlive: number): number {
  const prev = useRef<{ state: StateName; lastAlive: number } | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const was = prev.current;
    prev.current = { state, lastAlive };
    if (was && was.state !== "Active" && was.state !== "Completed" && state === "Active" && lastAlive > was.lastAlive) setKey(Date.now());
  }, [state, lastAlive]);
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => setKey(0), 3500);
    return () => clearTimeout(t);
  }, [key]);
  return key;
}

/** Sources whose timestamp just moved forward, with a changing key so the pulse replays. */
function usePulses(obs: Record<string, { at: string } | undefined> | undefined): Record<string, number> {
  const prev = useRef<Record<string, string>>({});
  const [pulses, setPulses] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!obs) return;
    const fresh: Record<string, number> = {};
    for (const [src, o] of Object.entries(obs)) {
      if (o && prev.current[src] && o.at !== prev.current[src]) fresh[src] = Date.now();
      if (o) prev.current[src] = o.at;
    }
    if (Object.keys(fresh).length) {
      setPulses((p) => ({ ...p, ...fresh }));
      const t = setTimeout(() => setPulses((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !(k in fresh)))), 2500);
      return () => clearTimeout(t);
    }
  }, [obs]);
  return pulses;
}
