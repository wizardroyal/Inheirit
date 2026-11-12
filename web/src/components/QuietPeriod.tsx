"use client";
// The quiet period, from the owner's own rhythm (CLAUDE.md §7.2): "longer than usual" measured, not
// assumed. Reads the owner's NEAR (and Sepolia, if given) history in the browser, suggests a period,
// and the owner confirms or edits it. Real timings only; the demo clock keeps minutes.
import { useEffect, useRef, useState } from "react";
import { type Baseline, everyPhrase, fetchBaseline } from "@agent/liveness/baseline";
import { REAL_SCHEDULE } from "@/lib/config";
import { Field, inputCls } from "./ui";

const DAY = 86_400;

/** The real-timing schedule with the owner's quiet period. */
export function realSchedule(quietDays: number | null) {
  const days = quietDays && quietDays >= 1 && quietDays <= 365 ? Math.round(quietDays) : REAL_SCHEDULE.timings.quiet_after / DAY;
  return { ...REAL_SCHEDULE, timings: { ...REAL_SCHEDULE.timings, quiet_after: days * DAY } };
}

export function QuietPeriod({ owner, evm, value, onChange }: { owner: string; evm?: string; value: number | null; onChange: (days: number | null) => void }) {
  const [b, setB] = useState<Baseline | null>(null);
  // Follows the suggestion until the owner types their own number.
  const edited = useRef(false);
  const sepolia = evm && /^0x[0-9a-fA-F]{40}$/.test(evm) ? evm : "";
  useEffect(() => {
    let live = true;
    setB(null);
    fetchBaseline([owner], sepolia ? [sepolia] : [])
      .then((r) => {
        if (!live) return;
        setB(r);
        if (!edited.current) onChange(r.suggestedQuietS / DAY);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, sepolia]);

  const suggested = b ? b.suggestedQuietS / DAY : null;
  return (
    <Field
      label="Checks start after this many quiet days"
      hint={
        !b
          ? "Reading your transaction history…"
          : b.medianGapS
            ? `You usually transact ${everyPhrase(b.medianGapS)} (${b.sources.join(" + ")}, last 90 days); we suggest ${suggested}.`
            : `Not enough history to say what's usual for you; we suggest ${suggested}.`
      }
    >
      <input
        className={`${inputCls} w-24`}
        inputMode="numeric"
        aria-label="Quiet days before checks"
        value={value ?? ""}
        onChange={(e) => {
          edited.current = true;
          onChange(e.target.value === "" ? null : Number(e.target.value));
        }}
      />
    </Field>
  );
}
