"use client";
// Pieces shared by the owner, guardian, heir and demo pages.
import { savedPolicy } from "@/lib/demo";
import { accountLabel, humanize, useNames } from "@/lib/names";
import { agent, type SignalSource } from "@/lib/agent";
import { explorer } from "@/lib/config";
import { useOverview } from "@/lib/hooks";
import { formatNear, signRequest } from "@/lib/near";
import { ago, haltReason, schedule, SOURCE_LABELS, type Will } from "@/lib/will";
import { ActionButton, ExtLink, Pill, short, SimulatedTag } from "./ui";

/** Every source the agent reads (agent §7.1), with its weight and whether it is SIMULATED. */
export const SOURCES: { source: SignalSource; simulated: boolean; weight: number }[] = [
  { source: "near_onchain", simulated: false, weight: 0.9 },
  { source: "evm_onchain", simulated: false, weight: 0.9 },
  { source: "phone_heartbeat", simulated: false, weight: 0.95 },
  { source: "telegram", simulated: false, weight: 0.7 },
  { source: "github", simulated: false, weight: 0.5 },
  { source: "google_calendar", simulated: true, weight: 0.7 },
  { source: "gmail", simulated: true, weight: 0.7 },
  { source: "x", simulated: true, weight: 0.4 },
  { source: "instagram", simulated: true, weight: 0.4 },
  { source: "tiktok", simulated: true, weight: 0.4 },
  { source: "facebook", simulated: true, weight: 0.4 },
    { source: "linkedin", simulated: true, weight: 0.4 },
];

/** strong (>= 0.9) and medium (0.7) count alone; weak needs a second source within 24 h. */
export function strength(weight: number): { label: "strong" | "medium" | "weak"; tone: "accent" | "neutral" } {
  if (weight >= 0.9) return { label: "strong", tone: "accent" };
  if (weight >= 0.7) return { label: "medium", tone: "accent" };
  return { label: "weak", tone: "neutral" };
}

/** What the agent watches for this owner, as counts and flags (never the other accounts themselves). */
export type Watching = { evm?: boolean; github?: boolean | string; email?: boolean; near_extra?: number; evm_count?: number; evmAddress?: string };

/**
 * Every sign-of-life source in one list (CLAUDE.md §7.1): its weight, and whether it is connected for
 * this owner. Sources we can't read yet are listed as "coming soon"; a SIMULATED demo signal still shows
 * when one was sent. Timestamps only, never content.
 */
export function SignalList({ owner, will }: { owner: string; will: Will | null }) {
  const { data: overview, error } = useOverview(owner);
  const data = overview?.signals;
  const w = (overview?.status?.watching ?? {}) as Watching;
  const evmCount = w.evm_count ?? (w.evm || w.evmAddress ? 1 : 0);
  const status: Partial<Record<SignalSource, string | null>> = {
    near_onchain: w.near_extra ? `your account + ${w.near_extra} more` : "your account",
    evm_onchain: evmCount ? `${evmCount} address${evmCount > 1 ? "es" : ""}` : null,
    phone_heartbeat: data?.heartbeat ? "app opened" : null,
    telegram: overview?.telegram?.linked ? "linked" : null,
    github: w.github ? "connected" : null,
  };
  return (
    <div className="space-y-2">
      <ul className="tech divide-y divide-line">
        {SOURCES.map((s) => {
          const at = data?.observations[s.source]?.at;
          const st = status[s.source];
          return (
            <li key={s.source} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-2">
                {SOURCE_LABELS[s.source]}
                <Pill tone={strength(s.weight).tone}>
                  {strength(s.weight).label} {s.weight}
                </Pill>
              </span>
              <span className="text-right text-muted">
                {s.simulated ? (
                  at ? (
                    <>
                      <SimulatedTag /> seen {ago(at)}
                    </>
                  ) : (
                    "coming soon"
                  )
                ) : st ? (
                  <>
                    <span className="text-accent">● {st}</span>
                    {at ? ` · ${ago(at)}` : ""}
                  </>
                ) : (
                  "not set"
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {will && <p className="text-xs text-muted">Last confirmed sign of life on-chain: {ago(will.last_alive_at)}.</p>}
      <p className="text-xs text-muted">
        Strong and medium signals count alone; weak ones need two sources within 24 h. Only times are read, never content.
      </p>
      {error && <p className="text-xs text-danger">Can&apos;t reach the will agent right now. Retrying.</p>}
    </div>
  );
}

/** A message body with its links shown as "open the page" instead of a raw URL full of account ids. */
function withLinks(text: string) {
  return text.split(/(https?:\/\/\S+)/).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <ExtLink key={i} href={part.replace(/[.,;]$/, "")}>
        open the page
      </ExtLink>
    ) : (
      part
    ),
  );
}

export function NotificationLog({ owner }: { owner: string }) {
  const { data: overview, error } = useOverview(owner);
  const names = useNames();
  const data = overview?.notifications;
  const items = [...(data ?? [])].reverse().slice(0, 20);
  return (
    <div>
      {items.length === 0 && <p className="text-sm text-muted">Nothing sent yet.</p>}
      <ul className="space-y-2">
        {items.map((n, i) => (
          <li key={i} className="rounded-lg border border-line px-3 py-2 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">{humanize(n.subject, names)}</span>
              <span className="text-xs text-muted">{ago(n.at)}</span>
            </div>
            <div className="text-xs text-muted">
              to {n.to.map((t) => humanize(t, names)).join(", ")} · via {n.channels.map((c) => (c === "ui" ? "this app" : c)).join(", ")}
            </div>
            <div className="mt-1 text-sm">{withLinks(humanize(n.body, names))}</div>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-danger">Can&apos;t reach the will agent right now. Retrying.</p>}
    </div>
  );
}

function amountText(chain: string, amount: string): string {
  if (chain === "Near") return `${formatNear(amount)} NEAR`;
  if (chain === "Eth") return `${(Number(amount) / 1e18).toFixed(6)} ETH`;
  return `${amount} sats`;
}

function txLink(chain: string, hash: string): string | null {
  if (!hash) return null;
  return chain === "Eth" ? explorer.ethTx(hash) : chain === "Btc" ? explorer.btcTx(hash) : explorer.nearTx(hash);
}

/** What has been released in the current round, per stage and chain, with explorer links. */
export function Releases({ will }: { will: Will }) {
  const names = useNames();
  const round = will.execution_round;
  const recs = will.executions.filter((e) => e.round === round);
  const chains = ["Near", ...will.foreign_chains] as const;
  if (round === 0) return <p className="text-sm text-muted">Nothing released.</p>;
  return (
    <div className="space-y-3">
      <table className="tech w-full">
        <thead className="tech-label text-left">
          <tr>
            <th className="py-1">Stage</th>
            {chains.map((c) => (
              <th key={c} className="py-1">
                {c === "Near" ? "NEAR" : c === "Eth" ? "Ethereum" : "Bitcoin"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schedule(will).map(({ pct }, stage) => (
            <tr key={stage} className="border-t border-line align-top">
              <td className="py-2">
                {stage + 1} <span className="text-muted">({pct}%)</span>
              </td>
              {chains.map((c) => {
                const rows = recs.filter((e) => e.stage === stage && e.chain === c);
                const done = c === "Near" ? rows.length > 0 : will.stage_done.some((d) => d.stage === stage && d.chain === c);
                return (
                  <td key={c} className="py-2">
                    {rows.map((e, i) => {
                      const link = txLink(c, e.tx_hash);
                      return (
                        <div key={i}>
                          {amountText(c, e.amount)} {link && <ExtLink href={link}>tx</ExtLink>}
                          <div className="text-xs text-muted">to {/\.testnet$/.test(e.to) ? accountLabel(e.to, names) : short(e.to, 8)}</div>
                        </div>
                      );
                    })}
                    {rows.length === 0 && <span className="text-muted">{done ? "nothing to send" : "—"}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted">NEAR is paid by the contract; Ethereum and Bitcoin by the agent via Chain Signatures.</p>
      {will.halted.filter((h) => h.round === round).map((h, i) => (
        <p key={i} className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Stopped at stage {h.stage + 1} {ago(h.at)}: {haltReason(h.reason)}.
        </p>
      ))}
    </div>
  );
}

/** Warns when the agent isn't watching this will (e.g. a setup step failed) and lets the owner fix it. */
export function WatchStatus({ owner, will, canSign }: { owner: string; will: Will; canSign: boolean }) {
  const { data: overview, refresh } = useOverview(owner);
  const data = overview?.status;
  if (!data || (data.watching && data.has_policy)) return null;
  return (
    <div className="space-y-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
      {!data.watching && <p>The agent isn&apos;t watching this will yet.</p>}
      {!data.has_policy && will.foreign_chains.length > 0 && (
        <p>The agent lacks the heirs&apos; Ethereum and Bitcoin addresses, so it can&apos;t release those vaults.</p>
      )}
      {!data.has_policy && canSign && savedPolicy(owner) && (
        <ActionButton tone="quiet" onClick={async () => agent.submitPolicy(owner, savedPolicy(owner)!).then(refresh)}>
          Send the will&apos;s details to the agent
        </ActionButton>
      )}
      {!data.watching && canSign && (
        <ActionButton tone="quiet" onClick={async () => agent.registerOwner(await signRequest(owner, "register_owner", {})).then(refresh)}>
          Ask the agent to watch this will
        </ActionButton>
      )}
    </div>
  );
}
