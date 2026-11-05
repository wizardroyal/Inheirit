"use client";
// The hero "Signs of life" panel (CLAUDE.md §8): live strips per source that pulse when a signal lands,
// the ladder as a horizontal progress bar with a countdown, a visible snap back to Active when a sign
// of life cancels an escalation, the agent's plain-English verdict, and what the agent can see.
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
  const { data: overview, refresh } = useOverview(owner);
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
    <section className="space-y-4 rounded-2xl border border-line bg-card p-5" aria-label="Signs of life">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl">Signs of life</h2>
        {!isArmed(will) && <Pill tone="warn">not armed: guardians haven&apos;t accepted</Pill>}
      </div>

      {/* The ladder as a progress bar */}
      <div>
        <div className="relative h-2 rounded-full bg-line">
          <div
            className="ladder-fill absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${((Math.max(idx, 0) + 1) / LADDER.length) * 100}%` }}
          />
        </div>
        <ol className="mt-2 grid text-[11px] leading-tight text-muted" style={{ gridTemplateColumns: `repeat(${LADDER.length}, minmax(0, 1fr))` }}>
          {LADDER.map((r, i) => (
            <li key={r.state} className={`pr-1 ${i === idx ? "font-semibold text-ink" : ""} ${i > idx ? "opacity-60" : ""}`}>
              <span className="hidden sm:inline">{r.label}</span>
              <span className="sm:hidden">{i === idx ? r.label : ""}</span>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">{LADDER[idx]?.label ?? state}</span>
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
            <span key={snapped} className="snap-flash rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-ink">
              Sign of life: back to All good
            </span>
          )}
        </div>
      </div>

      {/* Verdict */}
      {data?.verdict && (
        <div className="rounded-lg bg-accent-soft px-4 py-3">
          {/* The agent's verdict can trail the chain by a poll; at the snap-back, say what just happened. */}
          <p className="font-medium">{snapped > 0
              ? movedThisRound
                ? "Sign of life recorded on-chain. The remaining stages and the secrets are halted; what was already sent stays sent."
                : "Sign of life recorded on-chain. Everything is cancelled; nothing moved."
              : data.verdict.headline}</p>
          {data.verdict.details.map((d) => (
            <p key={d} className="mt-1 text-sm text-muted">
              {d}
            </p>
          ))}
        </div>
      )}

      {/* One strip per source */}
      <ul className="grid gap-2 sm:grid-cols-2">
        {seen.map((s) => {
          const at = data!.observations[s.source]!.at;
          const st = strength(s.weight);
          return (
            <li key={`${s.source}-${pulsing[s.source] ?? 0}`} className={`flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm ${pulsing[s.source] ? "signal-pulse" : ""}`}>
              <span className="flex flex-wrap items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${st.label === "weak" ? "bg-muted" : "bg-accent"}`} aria-hidden />
                {SOURCE_LABELS[s.source]}
                <Pill tone={st.tone}>{st.label}</Pill>
                {s.simulated && <SimulatedTag />}
              </span>
              <span className="text-muted">{ago(at)}</span>
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
          <span className="font-medium text-ink">What the agent saw: timestamps only.</span> It runs in a TEE and never reads or stores content.
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
