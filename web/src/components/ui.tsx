"use client";
import { useAccountLabel } from "@/lib/names";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { errorText } from "@/lib/near";

export function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-card p-5 sm:p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="font-serif text-xl">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "primary" | "quiet" | "danger";
const TONES: Record<Tone, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  quiet: "border border-line bg-card hover:bg-accent-soft",
  danger: "border border-danger text-danger hover:bg-danger-soft",
};

/** A button that runs an async action, shows progress, and reports errors in plain text. */
export function ActionButton({
  onClick,
  children,
  tone = "primary",
  disabled,
  className = "",
}: {
  onClick: () => Promise<unknown>;
  children: ReactNode;
  tone?: Tone;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onClick();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${className}`}
      >
        {busy ? "Working…" : children}
      </button>
      {error && <span className="max-w-md text-xs text-danger">{error}</span>}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "sim" }) {
  const cls = {
    neutral: "bg-bg text-muted border border-line",
    accent: "bg-accent-soft text-accent",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    sim: "bg-sim-soft text-sim",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function SimulatedTag() {
  return (
    <span title="Simulated: not connected to a real service." className="inline-flex">
      <Pill tone="sim">SIMULATED</Pill>
    </span>
  );
}

export function Details({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer select-none text-muted hover:text-ink">{summary}</summary>
      <div className="tech mt-2 space-y-1 break-all border-l border-line-strong pl-3 text-muted">{children}</div>
    </details>
  );
}

/**
 * A labelled field. `group` renders a fieldset for groups of controls (chips with × buttons): a <label>
 * would forward a click on its text to the first button inside it.
 */
export function Field({ label, children, hint, group }: { label: string; children: ReactNode; hint?: string; group?: boolean }) {
  if (group)
    return (
      <fieldset className="flex min-w-0 flex-col gap-1 text-sm">
        <legend className="mb-1 font-medium">{label}</legend>
        {children}
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </fieldset>
    );
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "rounded-lg border border-field bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-1 underline-offset-2 hover:decoration-2">
      {children}
    </a>
  );
}

export function short(s: string, n = 10): string {
  return s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-6)}` : s;
}

/** A full link on this site with a copy button, for sending to guardians, contacts or heirs. */
export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-lg border border-line bg-card px-3 py-1 text-sm hover:bg-accent-soft"
        onClick={() =>
          navigator.clipboard.writeText(url).then(
            () => (setCopied(true), setTimeout(() => setCopied(false), 1500)),
            () => setCopied(false),
          )
        }
      >
        {copied ? "Link copied" : "Copy invitation link"}
      </button>
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{children}</p>;
}

/** Empty state for a page addressed to an owner whose will doesn't exist (yet) on this contract. */
export function NoWill({ owner }: { owner: string }) {
  const label = useAccountLabel();
  return (
    <Card title="No will found">
      <div className="space-y-2 text-sm">
        <p>
          No will for <span className="font-medium">{label(owner)}</span> yet. Check the link, or reload in a few seconds.
        </p>
        <p className="text-muted">
          <Link href="/account" className="text-accent underline">Try it with a demo account</Link>.
        </p>
      </div>
    </Card>
  );
}

/** A destructive action that asks first: the first tap shows "Sure? Yes · Cancel". */
export function ConfirmButton({ label, question, onConfirm }: { label: string; question: string; onConfirm: () => Promise<unknown> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <button type="button" className="min-h-11 rounded-lg border border-line px-4 py-2 hover:bg-danger-soft hover:text-danger" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{question}</span>
      <button
        type="button"
        disabled={busy}
        className="min-h-11 rounded-lg border border-danger px-4 py-2 text-danger hover:bg-danger-soft disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? "…" : "Yes"}
      </button>
      <button type="button" className="min-h-11 px-3 py-2 text-muted underline" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
