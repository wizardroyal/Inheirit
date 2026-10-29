"use client";
import { useNow } from "@/lib/hooks";
import { duration, LADDER, nextStepIn, stateName, type Will } from "@/lib/will";

/** The escalation ladder with the will's current rung highlighted and the next automatic step. */
export function Ladder({ will }: { will: Will }) {
  const now = useNow();
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
          return (
            <li key={r.state} className={`flex gap-3 rounded-lg px-3 py-2 ${on ? "bg-accent-soft" : ""}`}>
              <span
                className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${on ? "border-accent bg-accent" : past ? "border-accent" : "border-line"}`}
                aria-hidden
              />
              <div>
                <div className={`text-sm ${on ? "font-semibold" : past ? "" : "text-muted"}`}>
                  {r.label}
                  {on && r.state === "GuardianVote" && <span className="ml-2 text-xs text-muted">{votes} of {will.guardian_threshold} confirmed</span>}
                  {on && r.state === "Executing" && (
                    <span className="ml-2 text-xs text-muted">
                      stage {(will.state as { Executing: { stage: number } }).Executing.stage + 1} of {will.stages_pct.length}
                    </span>
                  )}
                </div>
                {on && <div className="text-xs text-muted">{r.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {next && (
        <p className="mt-3 text-xs text-muted">
          {next.seconds > 0 ? (
            <>
              Next: {next.label} in about <span className="font-medium text-ink">{duration(next.seconds)}</span>
              {current === "GuardianVote" && " (only if guardians don't reach the threshold first)"}
            </>
          ) : (
            <>Next: {next.label} — due now; the agent or anyone can call advance.</>
          )}
        </p>
      )}
    </div>
  );
}
