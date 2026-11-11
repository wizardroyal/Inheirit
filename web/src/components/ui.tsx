"use client";
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
    <span title="Simulated for the demo: this isn't connected to a real account or service." className="inline-flex">
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

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

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
  return (
    <Card title="No will found">
      <div className="space-y-2 text-sm">
        <p>
          There&apos;s no will for <span className="font-mono">{owner}</span> yet. Check the account name in the link you were sent. If the will was
          only just created, give it a few seconds and reload.
        </p>
        <p className="text-muted">
          Just exploring? <Link href="/owner" className="text-accent underline">Try it with a demo account</Link>: a sample will and its people are
          ready in about a minute.
        </p>
      </div>
    </Card>
  );
}
