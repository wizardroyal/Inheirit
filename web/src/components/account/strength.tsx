"use client";
// Will strength (CLAUDE.md §8): what arms the will, what makes it stronger, and the one next step.
// One source of truth for the Home bar, the next-step card and the signal chips.
import Link from "next/link";
import { useState } from "react";
import { useOverview } from "@/lib/hooks";
import { acceptedGuardians, isArmed, SOURCE_LABELS, type Will } from "@/lib/will";
import { SOURCES, strength as weightLabel, type Watching } from "../WillParts";
import { isBackedUp } from "./access";

export interface StrengthItem {
  label: string;
  done: boolean;
  required?: boolean;
  /** Where to fix it. */
  href: string;
  /** The suggestion shown when this is the next step. */
  next: string;
}

/** Connected status per signal source, from the agent's overview (flags and counts only). */
export function useSignalStatus(owner: string) {
  const { data: overview } = useOverview(owner);
  const w = (overview?.status?.watching ?? {}) as Watching;
  const evmCount = w.evm_count ?? (w.evm || w.evmAddress ? 1 : 0);
  const connected: Record<string, boolean> = {
    near_onchain: true,
    evm_onchain: evmCount > 0,
    phone_heartbeat: !!overview?.signals?.heartbeat,
    telegram: !!overview?.telegram?.linked,
    github: !!w.github,
  };
  return { overview, watching: w, evmCount, connected };
}

export function useStrength(will: Will) {
  const { overview, watching, evmCount, connected } = useSignalStatus(will.owner);
  const strongCount = 1 + (watching.near_extra ?? 0) + evmCount + (connected.phone_heartbeat ? 1 : 0);
  const accepted = acceptedGuardians(will).length;
  const missingGuardians = Math.max(0, will.guardian_threshold - accepted);
  const items: StrengthItem[] = [
    {
      label: `Guardians accepted (${accepted} of ${will.guardian_threshold} needed)`,
      done: isArmed(will),
      required: true,
      href: "/account/will",
      next: `Waiting for ${missingGuardians} more guardian${missingGuardians === 1 ? "" : "s"} to accept. Send them their link.`,
    },
    {
      label: "Access backed up",
      done: isBackedUp(will.owner),
      href: "/account/settings",
      next: "Back up your access. Your key lives only in this browser: lose it without a backup and you lose your will.",
    },
    { label: "Heartbeat app opened", done: connected.phone_heartbeat, href: "/heartbeat", next: "Open the heartbeat app on your phone and add it to your home screen." },
    { label: `Two strong signs of life (${strongCount})`, done: strongCount >= 2, href: "/account/signs", next: "Connect another wallet you use: NEAR, Ethereum or Bitcoin." },
    { label: "Telegram for checks", done: connected.telegram, href: "/account/settings", next: "Link Telegram so a check reaches your phone." },
    { label: "Email for checks", done: !!watching.email, href: "/account/settings", next: "Add your email for checks and alerts." },
    { label: "A friend for welfare checks", done: will.contacts.length > 0, href: "/account/will", next: "Add a friend who'd notice if you went quiet." },
    { label: "A lawyer", done: !!will.lawyer, href: "/account/will", next: "Name a lawyer: they can speed up the release, never skip a step." },
    { label: "A final secret for an heir", done: will.sealed_notes.length > 0, href: "/account/secrets", next: "Leave a sealed note: where the hardware wallet is, who holds the passphrase." },
    { label: "Something in the vault", done: BigInt(will.near_balance) > 0n || will.sealed_notes.length > 0, href: "/account/vault", next: "Put some NEAR in the vault (or keep it notes-only)." },
  ];
  const optional = items.filter((i) => !i.required);
  const score = Math.round((optional.filter((i) => i.done).length / optional.length) * 100);
  const armed = isArmed(will);
  const next = items.find((i) => i.required && !i.done) ?? items.find((i) => !i.done) ?? null;
  return { items, score, armed, next, connected, overview, strongCount };
}

/**
 * The strength bar: the score at the end, a gear to Signs of life, and a chevron that expands (tap,
 * not hover) to the signals added (with weights) and the ones missing ("+ Add"). Not armed: red, with
 * the one reason that blocks it.
 */
export function StrengthBar({ will }: { will: Will }) {
  const { score, armed, items, connected } = useStrength(will);
  const [open, setOpen] = useState(false);
  const blocking = items.find((i) => i.required && !i.done);
  const real = SOURCES.filter((s) => !s.simulated);
  return (
    <section aria-label="Will strength" className="rounded-2xl border border-line bg-card p-5">
      <div className="flex items-center gap-3">
        <h2 className="font-serif text-xl">Will strength</h2>
        <span className="ml-auto flex items-center gap-1">
          <Link href="/account/signs" aria-label="Signs of life settings" title="Signs of life" className="rounded-lg p-2 text-muted hover:bg-accent-soft hover:text-ink">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
            </svg>
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Hide signals" : "Show signals"}
            className="rounded-lg p-2 text-muted hover:bg-accent-soft hover:text-ink"
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={armed ? score : 0}>
          <div className={`h-full rounded-full ${armed ? "bg-accent" : "bg-danger"}`} style={{ width: `${armed ? Math.max(score, 4) : 100}%` }} />
        </div>
        <span className={`w-14 text-right text-lg font-medium ${armed ? "" : "text-danger"}`}>{armed ? `${score}%` : "off"}</span>
      </div>
      {!armed && blocking && <p className="mt-2 text-danger">Not armed: {blocking.next}</p>}
      {open && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {real.map((s) =>
            connected[s.source] ? (
              <li key={s.source} className="rounded-full bg-accent-soft px-3 py-1 text-sm">
                {SOURCE_LABELS[s.source]} · {weightLabel(s.weight).label}
              </li>
            ) : (
              <li key={s.source}>
                <Link href={s.source === "phone_heartbeat" ? "/heartbeat" : s.source === "telegram" ? "/account/settings" : "/account/signs"} className="inline-block rounded-full border border-dashed border-line px-3 py-1 text-sm text-muted hover:text-ink">
                  + Add {SOURCE_LABELS[s.source]}
                </Link>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/** The one suggested next step. */
export function NextStep({ will }: { will: Will }) {
  const { next } = useStrength(will);
  if (!next) return <p className="text-muted">Your will is as strong as it gets. Nothing to do.</p>;
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <p className="text-sm text-muted">Next step</p>
      <p className="mt-1 text-lg">{next.next}</p>
      <Link href={next.href} className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90">
        Do it
      </Link>
    </section>
  );
}
