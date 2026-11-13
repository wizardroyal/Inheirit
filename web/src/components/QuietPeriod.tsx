"use client";
// The quiet period, from the owner's own rhythm (CLAUDE.md §7.2): "longer than usual" measured, not
// assumed. Reads the owner's NEAR (and Sepolia, if given) history in the browser, suggests a period,
// and the owner chooses (we suggest, we never adjust it). Real timings only; the demo clock keeps minutes.
import { useEffect, useState } from "react";
import { type Baseline, everyPhrase, fetchBaseline } from "@agent/liveness/baseline";
import { REAL_SCHEDULE } from "@/lib/config";
import { inputCls } from "./ui";

const DAY = 86_400;

/** The real-timing schedule with the owner's quiet period. */
export function realSchedule(quietDays: number | null) {
  const days = quietDays && quietDays >= 1 && quietDays <= 365 ? Math.round(quietDays) : REAL_SCHEDULE.timings.quiet_after / DAY;
  return { ...REAL_SCHEDULE, timings: { ...REAL_SCHEDULE.timings, quiet_after: days * DAY } };
}

export function QuietPeriod({ owner, evm, value, onChange }: { owner: string; evm?: string; value: number | null; onChange: (days: number | null) => void }) {
  const [b, setB] = useState<Baseline | null>(null);
  const sepolia = evm && /^0x[0-9a-fA-F]{40}$/.test(evm) ? evm : "";
  useEffect(() => {
    let live = true;
    setB(null);
    fetchBaseline([owner], sepolia ? [sepolia] : [])
      .then((r) => {
        if (!live) return;
        setB(r);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, sepolia]);

  const suggested = b ? b.suggestedQuietS / DAY : null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="font-medium" htmlFor="quiet-days">
        Checks start after these many days of signal silence
      </label>
      <input
        id="quiet-days"
        className={`${inputCls} w-24`}
        inputMode="numeric"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
      {suggested !== null && value !== suggested && (
        <button type="button" className="min-h-11 self-start rounded-lg border border-line px-3 py-1 text-ink hover:bg-accent-soft" onClick={() => onChange(suggested)}>
          Use {suggested} days{b?.medianGapS ? ` (you're usually active ${everyPhrase(b.medianGapS)})` : ""}
        </button>
      )}
    </div>
  );
}
