"use client";
// Demo control panel for judges (CLAUDE.md §8): demo tooling, not part of the product.
import { accountLabel, useAccountLabel, useNames } from "@/lib/names";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Ladder } from "@/components/Ladder";
import { ActionButton, Card, ExtLink, Pill, short, SimulatedTag } from "@/components/ui";
import { SignsOfLife } from "@/components/SignsOfLife";
import { ProgressLog, Vaults } from "@/components/Vaults";
import { FundAnywhere, PayoutsPanel } from "@/components/Payouts";
import { NotificationLog, Releases, SignalList, WatchStatus } from "@/components/WillParts";
import { agent, type SignalSource } from "@/lib/agent";
import { CONTRACT_ID, DEMO_SCHEDULE, explorer } from "@/lib/config";
import { acceptAsGuardians, addSealedNote, createCast, createWill, DEMO_NOTE, demoHeirReceive, demoPolicy, fundFromFaucet } from "@/lib/demo";
import { useKeys, usePoll, useWill } from "@/lib/hooks";
import type { Cast } from "@/lib/keys";
import { call, ROLE_TGAS, signRequest } from "@/lib/near";
import { ago, haltReason, stateName, type StateName, type Will } from "@/lib/will";

const SIMULATED: { source: SignalSource; label: string }[] = [
  { source: "x", label: "X post" },
  { source: "instagram", label: "Instagram post" },
  { source: "google_calendar", label: "Calendar event" },
  { source: "gmail", label: "Sent email" },
];

export default function DemoPage() {
  const { casts } = useKeys();
  const [ownerSel, setOwnerSel] = useState("");
  const cast = casts.find((c) => c.owner === ownerSel) ?? casts[0] ?? null;
  const { data: root, error: agentError } = usePoll(() => agent.root(), 30_000);
  const [log, setLog] = useState<string[]>([]);
  const progress = (m: string) => setLog((l) => [...l, m]);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-4xl sm:text-5xl">Control panel</h1>
          <Pill tone="warn">advanced</Pill>
        </div>
        <p className="max-w-2xl text-lg text-muted">
          Drive a will by hand, playing every role. Quiet after {DEMO_SCHEDULE.timings.quiet_after / 60} minutes, not months.
        </p>
        <p className="text-sm text-muted">
          New here?{" "}
          <Link href="/account" className="text-accent underline">
            The guided version is easier
          </Link>
          .
        </p>
        <div className="tech flex flex-wrap gap-2">
          <span className="rounded border border-line-strong px-2 py-0.5">contract {CONTRACT_ID}</span>
          {root ? (
            <span className={`rounded px-2 py-0.5 ${root.demoMode ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn"}`}>
              ● agent online{root.demoMode ? " · demo mode" : " · demo mode off"}
            </span>
          ) : null}
          {agentError && <span className="rounded bg-danger-soft px-2 py-0.5 text-danger">● agent unreachable</span>}
        </div>
      </div>

      <Card title="1 · The cast" aside={casts.length > 1 && <CastPicker casts={casts} value={cast?.owner ?? ""} onChange={setOwnerSel} />}>
        {cast ? (
          <CastSummary cast={cast} />
        ) : (
          <p className="text-muted">
            Six funded testnet people (owner, heir, three guardians, friend), keys in this browser. About 20 s.
          </p>
        )}
        <div className="mt-4">
          <ActionButton
            tone={cast ? "quiet" : "primary"}
            onClick={async () => {
              setLog([]);
              const c = await createCast(progress);
              setOwnerSel(c.owner);
              progress("Cast ready.");
            }}
          >
            {cast ? "Make another cast" : "Make a test cast"}
          </ActionButton>
        </div>
        <ProgressLog lines={log} />
      </Card>

      {cast && <WillPanel key={cast.owner} cast={cast} />}
    </div>
  );
}

function CastPicker({ casts, value, onChange }: { casts: Cast[]; value: string; onChange: (o: string) => void }) {
  const label = useAccountLabel();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full max-w-xs rounded-lg border border-line bg-bg px-2 py-1 text-sm">
      {casts.map((c) => (
        <option key={c.owner} value={c.owner}>
          {label(c.owner)}&apos;s will ({ago(c.createdAt)})
        </option>
      ))}
    </select>
  );
}

/** Who's who: names for people, the account ids (with explorer links) in the technical column. */
function CastSummary({ cast }: { cast: Cast }) {
  const label = useAccountLabel();
  const rows: [string, string][] = [
    ["Owner", cast.owner],
    ["Heir", cast.heir],
    ...cast.guardians.map((g, i) => [`Guardian ${i + 1}`, g] as [string, string]),
    ["Friend", cast.contact],
  ];
  return (
    <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line py-1.5">
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="min-w-0 truncate text-right">
            <span className="font-medium">{label(v)}</span>{" "}
            <ExtLink href={explorer.nearAccount(v)}>
              <span className="tech">account</span>
            </ExtLink>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function WillPanel({ cast }: { cast: Cast }) {
  const { data: will, loaded, refresh } = useWill(cast.owner);
  const label = useAccountLabel();
  const ownerN = label(cast.owner);
  const heirN = label(cast.heir);
  const [chains, setChains] = useState<{ Eth: boolean; Btc: boolean }>({ Eth: true, Btc: true });
  const [withNote, setWithNote] = useState(true);
  const [stable, setStable] = useState(false);
  // Keep the setup view until every step has finished, even after the will shows up on-chain
  const [creating, setCreating] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const progress = (m: string) => setLog((l) => [...l, m]);
  const events = useEventLog(will ?? null);
  const [technical, setTechnical] = useState(false);

  if (!loaded) return <Card>Loading…</Card>;
  if (!will || creating)
    return (
      <Card title="2 · Write the demo will">
        <p className="text-sm text-muted">
          Everything to {heirN} in 10/20/30/40%; two of three guardians must confirm. 0.5 NEAR in the vault; the faucet funds Ethereum and Bitcoin.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {(["Eth", "Btc"] as const).map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input type="checkbox" checked={chains[c]} onChange={(e) => setChains({ ...chains, [c]: e.target.checked })} />
              {c === "Eth" ? "Ethereum vault" : "Bitcoin vault"}
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={withNote} onChange={(e) => setWithNote(e.target.checked)} />
            Seal a note for {heirN}
          </label>
          <label className="flex items-center gap-2" title={`NEAR Intents converts each released slice to USDC on the chain ${heirN} chooses`}>
            <input type="checkbox" checked={stable} onChange={(e) => setStable(e.target.checked)} />
            Pay {heirN} in dollars (USDC, stable value)
          </label>
        </div>
        <div className="mt-3">
          <ActionButton
            disabled={!!will && !creating}
            onClick={async () => {
              setLog([]);
              setCreating(true);
              try {
                await createWill(
                cast.owner,
                {
                  policy: demoPolicy(cast, await demoHeirReceive(), { stable }),
                  contacts: [cast.contact],
                  schedule: DEMO_SCHEDULE,
                  foreignChains: (["Eth", "Btc"] as const).filter((c) => chains[c]),
                  depositNear: "0.5",
                },
                progress,
              );
                // Guardians must accept before they count; until then the will is not armed.
                await acceptAsGuardians(cast.owner, cast.guardians, progress);
                const foreign = (["Eth", "Btc"] as const).filter((c) => chains[c]);
                if (foreign.length && (await agent.faucetInfo()).enabled) {
                  progress("Asking the demo faucet to fund the Ethereum and Bitcoin vaults (about 30 s)…");
                  await fundFromFaucet(cast.owner, progress);
                }
                if (withNote) {
                  progress(`Sealing "${DEMO_NOTE.label}" in this browser to the agent's TEE key…`);
                  await addSealedNote(cast.owner, cast.heir, DEMO_NOTE.label, DEMO_NOTE.text);
                }
                progress("Will created. The agent is watching.");
                await refresh();
                await new Promise((r) => setTimeout(r, 1500));
              } finally {
                setCreating(false);
              }
            }}
          >
            Create the demo will
          </ActionButton>
        </div>
        <ProgressLog lines={log} />
      </Card>
    );
  const s = stateName(will.state);
  const done = s === "Completed";
  return (
    <div className="space-y-6">
      <SignsOfLife owner={cast.owner} will={will} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="min-w-0 space-y-6">
        <Card title="Where the will stands" aside={<Link href={`/account?as=${cast.owner}`} className="text-sm text-accent underline">{ownerN}&apos;s own view</Link>}>
          <WatchStatus owner={cast.owner} will={will} canSign />
          <Ladder will={will} compact />
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton tone="quiet" disabled={done} onClick={() => call(cast.funder, "advance", { owner: cast.owner }).then(refresh)}>
              Advance now (if due)
            </ActionButton>
          </div>
          <p className="mt-2 text-xs text-muted">The agent does this every 15 s. It moves only once the wait is over.</p>
        </Card>

        <Card title="Send a sign of life">
          <p className="mb-3 text-sm text-muted">Do nothing and it climbs. Then stop it:</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={done} onClick={async () => agent.heartbeat(await signRequest(cast.owner, "heartbeat"))}>
              Heartbeat (real, signed by {ownerN})
            </ActionButton>
            <ActionButton tone="quiet" disabled={done} onClick={() => call(cast.owner, "i_am_alive").then(refresh)}>
              {ownerN}: “I&apos;m alive” on-chain
            </ActionButton>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SimulatedTag />
            {SIMULATED.map((x) => (
              <ActionButton key={x.source} tone="quiet" disabled={done} onClick={async () => agent.simulate(await signRequest(cast.owner, "demo_signal", { source: x.source }))}>
                {x.label}
              </ActionButton>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            One social post alone is ignored. Two weak sources within 24 h count, as does any strong one.
          </p>
          <div className="mt-4">
            <SignalList owner={cast.owner} will={will} />
          </div>
        </Card>

        <Card title="Guardians and a friend">
          <ul className="space-y-2 text-sm">
            {cast.guardians.map((g) => {
              const a = will.attestations.find((x) => x.guardian === g);
              return (
                <li key={g} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {label(g)} {a && <Pill tone={a.kind === "Deceased" ? "danger" : "accent"}>{a.kind === "Deceased" ? "confirmed passing" : "says alive"}</Pill>}
                  </span>
                  <span className="flex gap-2">
                    <ActionButton tone="danger" disabled={s !== "GuardianVote" || !!a} onClick={() => call(g, "attest", { owner: cast.owner, kind: "Deceased", evidence_hash: null }, 0n, ROLE_TGAS).then(refresh)}>
                      Confirm passing
                    </ActionButton>
                    <ActionButton tone="quiet" disabled={s !== "GuardianVote" || !!a} onClick={() => call(g, "attest", { owner: cast.owner, kind: "Alive", evidence_hash: null }, 0n, ROLE_TGAS).then(refresh)}>
                      Alive
                    </ActionButton>
                  </span>
                </li>
              );
            })}
            <li className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <span>Friend: {label(cast.contact)}</span>
              <ActionButton tone="quiet" disabled={s !== "Quiet" && s !== "WelfareCheck"} onClick={() => call(cast.contact, "contact_confirm_alive", { owner: cast.owner }, 0n, ROLE_TGAS).then(refresh)}>
                “I heard from {ownerN}”
              </ActionButton>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted">
            Votes open only in the guardian vote; the friend answers in Quiet or the welfare check. Pages:{" "}
            <Link className="text-accent underline" href={`/guardian/${cast.owner}`}>guardian</Link>,{" "}
            <Link className="text-accent underline" href={`/heir/${cast.owner}`}>heir</Link>.
          </p>
        </Card>
      </div>

      <div className="min-w-0 space-y-6">
        <Vaults owner={cast.owner} will={will} />
        <Card title="Released so far">
          <Releases will={will} />
        </Card>
        <Card
          title="Payouts to heirs (NEAR Intents)"
          aside={
            <Link href={`/heir/${cast.owner}`} className="text-sm text-accent underline">
              {heirN} chooses here
            </Link>
          }
        >
          <PayoutsPanel owner={cast.owner} />
        </Card>
        {s === "Active" && (
          <Card title="Fund from another chain (NEAR Intents)">
            <FundAnywhere owner={cast.owner} vaults={["Near", ...will.foreign_chains]} />
          </Card>
        )}
        <Card
          title="What happened"
          aside={
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} /> technical names
            </label>
          }
        >
          {events.length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
          <ul className="tech space-y-1">
            {[...events].reverse().map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-16 shrink-0 text-xs text-muted">{e.at}</span>
                <span>
                  {e.text}
                  {technical && e.tech && <span className="ml-2 font-mono text-xs text-muted">{e.tech}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Messages the agent sent">
          <NotificationLog owner={cast.owner} />
        </Card>
      </div>
      </div>
    </div>
  );
}

/** Turns successive will snapshots into a readable log of what changed. */
function useEventLog(will: Will | null) {
  const names = useNames();
  const prev = useRef<Will | null>(null);
  const [events, setEvents] = useState<{ at: string; text: string; tech?: string }[]>([]);
  useEffect(() => {
    if (!will) return;
    const p = prev.current;
    prev.current = will;
    if (!p) return;
    const out: { text: string; tech?: string }[] = [];
    const a = stateName(p.state);
    const b = stateName(will.state);
    if (a !== b || JSON.stringify(p.state) !== JSON.stringify(will.state)) {
      const tech = `${a} → ${b}`;
      // No new sign of life: the vote period ran out short of the threshold (§5.3 vote_failed)
      if (a === "GuardianVote" && b === "Active" && will.last_alive_at === p.last_alive_at)
        out.push({ text: "Guardian vote expired. The owner is still silent, so the ladder restarts", tech });
      else out.push({ text: describeTransition(a, b, will, accountLabel(will.owner, names)), tech });
    }
    if (will.last_alive_at > p.last_alive_at) out.push({ text: "Sign of life recorded on-chain", tech: "record_liveness" });
    for (const x of will.attestations.slice(p.attestations.length))
      out.push({ text: `${accountLabel(x.guardian, names)} confirmed ${x.kind === "Deceased" ? "a passing" : "they're alive"}`, tech: `attest(${x.kind})` });
    for (const x of will.executions.slice(p.executions.length))
      out.push({ text: `Stage ${x.stage + 1} sent on ${x.chain === "Near" ? "NEAR" : x.chain === "Eth" ? "Ethereum" : "Bitcoin"} to ${/\.testnet$/.test(x.to) ? accountLabel(x.to, names) : short(x.to, 8)}`, tech: "record_execution" });
    for (const x of will.released_notes.slice(p.released_notes.length))
      out.push({ text: `Sealed note "${x.label}" released to ${accountLabel(x.heir, names)}`, tech: "store_released_note" });
    for (const x of will.halted.slice(p.halted.length)) out.push({ text: `Remaining stages and sealed notes stopped: ${haltReason(x.reason)}`, tech: `halt(${x.reason})` });
    if (out.length) {
      const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setEvents((e) => [...e, ...out.map((o) => ({ at, ...o }))].slice(-100));
    }
  }, [will]);
  return events;
}

/** The ladder in plain words for the timeline; raw state names stay in the technical view. */
function describeTransition(a: StateName, b: StateName, will: Will, who: string): string {
  if (b === "Active") return `Sign of life: back to All good`;
  switch (b) {
    case "Quiet":
      return `${who} went quiet. Checking in: heartbeat app, email, Telegram, DMs`;
    case "WelfareCheck":
      return "No reply to the checks. The guardians and the friend are asked";
    case "GuardianVote":
      return "Nobody has heard from them. Guardians are asked to vote";
    case "Challenge":
      return "Guardians confirmed. Challenge period: the owner is alerted on every channel";
    case "Executing": {
      const e = (will.state as { Executing: { stage: number } }).Executing;
      const pct = (will.round_stages[e.stage] ?? { pct: 0 }).pct;
      return a === "Executing" ? `Stage ${e.stage + 1} released (${pct}%)` : `The will is being carried out: first ${pct}% released`;
    }
    case "SecretsBuffer":
      return "Everything handed over. One last wait before the sealed notes";
    case "SecretsReleased":
      return "Sealed notes released to the heirs";
    case "Completed":
      return "The will has been carried out";
    default:
      return `${a} → ${b}`;
  }
}
