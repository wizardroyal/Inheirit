"use client";
// Home: one status hero, the strength bar, one next step, one line of recent activity.
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "@/lib/account";
import { useOverview } from "@/lib/hooks";
import { humanize, useNames } from "@/lib/names";
import { call, canSign } from "@/lib/near";
import { ago, duration, LADDER, nextStepIn, SOURCE_LABELS, stateName, type Will } from "@/lib/will";
import { useNow } from "@/lib/hooks";
import { ActionButton, NoWill } from "../ui";

/** Screens that need a will: a gentle pointer to Home when there is none yet. */
export function WillGate({ children }: { children: (will: Will) => ReactNode }) {
  const { owner, will, loaded, viewing } = useAccount();
  if (!loaded) return <p className="text-muted">Loading…</p>;
  if (!will) {
    if (viewing) return <NoWill owner={owner} />;
    return (
      <p className="text-lg">
        You don&apos;t have a will yet.{" "}
        <Link href="/account" className="text-accent underline">
          Write it on Home
        </Link>
        .
      </p>
    );
  }
  return <>{children(will)}</>;
}

/** The state in plain words, when we last saw a sign of life and how, and "I'm here". */
export function StatusHero({ will, refresh }: { will: Will; refresh: () => void }) {
  const { viewing } = useAccount();
  const { data: overview } = useOverview(will.owner);
  const now = useNow();
  const s = stateName(will.state);
  const idx = LADDER.findIndex((l) => l.state === s);
  const step = LADDER[idx];
  const next = nextStepIn(will, now);
  // The freshest strong or medium sign of life, as the agent saw it.
  const seen = Object.entries(overview?.signals?.observations ?? {})
    .filter(([, o]) => o && o.trustWeight >= 0.7 && !o.simulated)
    .sort(([, a], [, b]) => Date.parse(b!.at) - Date.parse(a!.at))[0];
  // Snap-back: a brief wash when the will returns to All good.
  const prev = useRef(s);
  const [snapped, setSnapped] = useState(false);
  useEffect(() => {
    if (prev.current !== s && s === "Active") {
      setSnapped(true);
      const t = setTimeout(() => setSnapped(false), 2500);
      prev.current = s;
      return () => clearTimeout(t);
    }
    prev.current = s;
  }, [s]);
  const calm = s === "Active";
  return (
    <section aria-live="polite" className={`rounded-2xl border p-6 sm:p-8 ${calm ? "border-line bg-card" : "border-warn bg-warn-soft"} ${snapped ? "snap-wash" : ""}`}>
      <p className="text-muted">Your will is</p>
      <h1 className="mt-1 font-serif text-4xl sm:text-5xl">{snapped ? "Back to All good" : step?.label ?? "…"}</h1>
      <p className="mt-3 max-w-2xl text-lg">{step?.detail}</p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="ladder-fill h-full rounded-full bg-accent" style={{ width: `${((Math.max(idx, 0) + 1) / LADDER.length) * 100}%` }} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="text-lg">
          {seen ? (
            <>
              Last seen <b>{ago(seen[1]!.at)}</b> via {SOURCE_LABELS[seen[0]] ?? "a sign of life"}
            </>
          ) : (
            <>Last sign of life recorded {ago(will.last_alive_at)}</>
          )}
          {next && <span className="text-muted"> · {next.label.toLowerCase()} in {duration(Math.max(0, next.seconds))}</span>}
        </p>
        {!viewing && canSign(will.owner) && s !== "Completed" && (
          <ActionButton onClick={() => call(will.owner, "i_am_alive").then(refresh)}>I&apos;m here</ActionButton>
        )}
      </div>
    </section>
  );
}

/** The latest thing that happened, in one line. */
export function RecentLine({ owner }: { owner: string }) {
  const { data: overview } = useOverview(owner);
  const names = useNames();
  const last = [...(overview?.notifications ?? [])].pop();
  return (
    <p className="text-muted">
      {last ? (
        <>
          Latest: {humanize(last.subject, names)} · {ago(last.at)}.{" "}
        </>
      ) : (
        <>Nothing has happened yet. </>
      )}
      <Link href="/account/activity" className="text-accent underline">
        All activity
      </Link>
    </p>
  );
}
