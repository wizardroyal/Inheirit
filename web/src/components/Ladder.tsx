"use client";
import { useState } from "react";
import { useNow } from "@/lib/hooks";
import { duration, isArmed, LADDER, nextStepIn, schedule, stateName, type Will } from "@/lib/will";

/**
 * The escalation ladder with the will's current rung highlighted and the next automatic step.
 * `compact` shows only the current rung (the Signs of life bar already shows the whole ladder) until expanded.
 */
export function Ladder({ will, compact = false }: { will: Will; compact?: boolean }) {
  const now = useNow();
  const [expanded, setExpanded] = useState(!compact);
  const current = stateName(will.state);
  const idx = LADDER.findIndex((r) => r.state === current);
  const next = nextStepIn(will, now);
  const votes = will.attestations.filter((a) => a.kind === "Deceased").length;
  return (
    <div>
      <ol className="space-y-1">
        {LADDER.map((r, i) => {
          const on = i === idx;
          const past = i < idx;
          if (!expanded && !on) return null;
          return (
            <li key={r.state} className={`flex gap-3 rounded-lg px-3 py-2 ${on ? "bg-accent-soft" : ""}`}>
              <span
                className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${on ? "border-accent bg-accent" : past ? "border-accent" : "border-line"}`}
                aria-hidden
              />
              <div>
                <div className={`text-sm ${on ? "font-semibold" : past ? "" : "text-muted"}`}>
                  {r.label}
                  {on && r.state === "GuardianVote" && <span className="ml-2 text-xs text-muted">{votes} of {will.guardian_threshold} confirmed</span>}
                  {on && r.state === "Executing" && (
                    <span className="ml-2 text-xs text-muted">
                      stage {(will.state as { Executing: { stage: number } }).Executing.stage + 1} of {schedule(will).length}
                      {will.accelerated && " (faster schedule)"}
                    </span>
                  )}
                  {on && r.state === "Active" && !isArmed(will) && (
                    <span className="ml-2 text-xs text-warn">not armed: waiting for guardians to accept</span>
                  )}
                </div>
                {on && <div className="text-xs text-muted">{r.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {compact && (
        <button type="button" className="mt-1 px-3 text-xs text-muted hover:text-ink" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Hide the other steps" : `Show all ${LADDER.length} steps`}
        </button>
      )}
      {next && (
        <p className="mt-3 text-xs text-muted">
          {next.seconds > 0 ? (
            <>
              Next: {next.label} in about <span className="font-medium text-ink">{duration(next.seconds)}</span>
              {current === "GuardianVote" && ", unless enough guardians confirm; otherwise back to All good"}
            </>
          ) : (
            <>Next: {next.label}, due now.</>
          )}
        </p>
      )}
    </div>
  );
}
