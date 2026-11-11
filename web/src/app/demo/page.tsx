"use client";
// Demo control panel for judges (CLAUDE.md §8): demo tooling, not part of the product.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AgentBadge } from "@/components/Attestation";
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
    <div className="tech space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-serif text-4xl">Control panel</h1>
          <Pill tone="warn">advanced</Pill>
        </div>
        <p className="max-w-3xl text-muted">
          The advanced, hands-on control panel, with throwaway testnet accounts whose keys stay in your browser. The clock is compressed: a will
          goes quiet after {DEMO_SCHEDULE.timings.quiet_after / 60} minutes of silence instead of weeks. Follow Scenario A (silence doesn&apos;t kill
          you) or Scenario B (it really executes) from the README. Prefer a guided tour?{" "}
          <Link href="/owner" className="text-accent underline">
            Sign in with a demo account and set your will in motion
          </Link>
          .
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Pill>contract {CONTRACT_ID}</Pill>
          {root ? <Pill tone={root.demoMode ? "accent" : "warn"}>agent online{root.demoMode ? ", demo mode" : ", demo mode off"}</Pill> : null}
          {agentError && <Pill tone="danger">agent unreachable</Pill>}
        </div>
      </div>

      <Card title="1 · The cast" aside={casts.length > 1 && <CastPicker casts={casts} value={cast?.owner ?? ""} onChange={setOwnerSel} />}>
        {cast ? <CastSummary cast={cast} /> : <p className="text-sm text-muted">No demo cast in this browser yet.</p>}
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <ActionButton
            tone={cast ? "quiet" : "primary"}
            onClick={async () => {
              setLog([]);
              const c = await createCast(progress);
              setOwnerSel(c.owner);
              progress("Cast ready.");
            }}
          >
            {cast ? "Create another cast" : "Create a demo cast"}
          </ActionButton>
          <span className="max-w-md text-xs text-muted">
            Makes a funded testnet account, then Alice (owner), Bola (heir), three guardians and a friend under it. About 20 seconds.
          </span>
        </div>
        <ProgressLog lines={log} />
      </Card>

      {cast && <WillPanel key={cast.owner} cast={cast} />}
    </div>
  );
}

function CastPicker({ casts, value, onChange }: { casts: Cast[]; value: string; onChange: (o: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full max-w-xs rounded-lg border border-line bg-bg px-2 py-1 text-sm">
      {casts.map((c) => (
        <option key={c.owner} value={c.owner}>
          {c.owner} ({ago(c.createdAt)})
        </option>
      ))}
    </select>
  );
}

function CastSummary({ cast }: { cast: Cast }) {
  const rows: [string, string][] = [
    ["Owner", cast.owner],
    ["Heir", cast.heir],
    ...cast.guardians.map((g, i) => [`Guardian ${i + 1}`, g] as [string, string]),
    ["Welfare contact", cast.contact],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 justify-between gap-2 border-b border-line py-1">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 truncate">
            <ExtLink href={explorer.nearAccount(v)}>{v}</ExtLink>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function WillPanel({ cast }: { cast: Cast }) {
  const { data: will, loaded, refresh } = useWill(cast.owner);
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
          Alice leaves everything to Bola, released in four stages (10%, 20%, 30%, 40%) with the longest wait after the first. Two of three
          guardians must confirm. 0.5 NEAR goes into the NEAR vault; the Sepolia and Bitcoin vaults are addresses derived by Chain Signatures, and
          the demo faucet funds them.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {(["Eth", "Btc"] as const).map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input type="checkbox" checked={chains[c]} onChange={(e) => setChains({ ...chains, [c]: e.target.checked })} />
              {c === "Eth" ? "Sepolia ETH vault" : "BTC testnet4 vault"}
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={withNote} onChange={(e) => setWithNote(e.target.checked)} />
            Seal a note for Bola
          </label>
          <label className="flex items-center gap-2" title="NEAR Intents converts each released slice to USDC on the chain Bola chooses">
            <input type="checkbox" checked={stable} onChange={(e) => setStable(e.target.checked)} />
            Pay Bola in dollars (USDC, stable value)
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
                  progress("Asking the demo faucet to fund the Sepolia and BTC vaults (about 30 s)…");
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
        <Card title="Where the will stands" aside={<Link href={`/owner?as=${cast.owner}`} className="text-sm text-accent underline">Alice&apos;s own view</Link>}>
          <WatchStatus owner={cast.owner} will={will} canSign />
          <Ladder will={will} compact />
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton tone="quiet" disabled={done} onClick={() => call(cast.funder, "advance", { owner: cast.owner }).then(refresh)}>
              Advance now (if due)
            </ActionButton>
          </div>
          <p className="mt-2 text-xs text-muted">The agent moves the will on by itself every 15 seconds. Anyone may press this too; it only moves once the wait is over.</p>
        </Card>

        <Card title="Signs of life">
          <p className="mb-3 text-sm text-muted">Do nothing and the will climbs the ladder. Then try to stop it:</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={done} onClick={async () => agent.heartbeat(await signRequest(cast.owner, "heartbeat"))}>
              Heartbeat (real, signed by Alice)
            </ActionButton>
            <ActionButton tone="quiet" disabled={done} onClick={() => call(cast.owner, "i_am_alive").then(refresh)}>
              Alice: “I&apos;m alive” on-chain
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
            A single X or Instagram post is ignored on purpose: someone else could be running the account. Two weak sources within 24 hours
            count, and so does any strong one. The agent checks every 15 seconds.
          </p>
          <div className="mt-4">
            <SignalList owner={cast.owner} will={will} />
          </div>
        </Card>

        <Card title="Guardians and contacts">
          <ul className="space-y-2 text-sm">
            {cast.guardians.map((g) => {
              const a = will.attestations.find((x) => x.guardian === g);
              return (
                <li key={g} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {short(g, 14)} {a && <Pill tone={a.kind === "Deceased" ? "danger" : "accent"}>{a.kind === "Deceased" ? "confirmed passing" : "says alive"}</Pill>}
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
              <span>Friend {short(cast.contact, 14)}</span>
              <ActionButton tone="quiet" disabled={s !== "Quiet" && s !== "WelfareCheck"} onClick={() => call(cast.contact, "contact_confirm_alive", { owner: cast.owner }, 0n, ROLE_TGAS).then(refresh)}>
                “I heard from Alice”
              </ActionButton>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted">
            Guardians can only vote during the guardian vote; the friend can only answer during Quiet or the welfare check. Their own pages:{" "}
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
              Bola chooses here
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
          {events.length === 0 && <p className="text-sm text-muted">Nothing has happened since you opened this page.</p>}
          <ul className="space-y-1 text-sm">
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
        <Card title="Why you can trust the agent">
          <AgentBadge />
        </Card>
      </div>
      </div>
    </div>
  );
}

/** Turns successive will snapshots into a readable log of what changed. */
function useEventLog(will: Will | null) {
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
        out.push({ text: "The guardian vote expired without enough confirmations. The owner is still silent, so the ladder starts again", tech });
      else out.push({ text: describeTransition(a, b, will), tech });
    }
    if (will.last_alive_at > p.last_alive_at) out.push({ text: "Sign of life recorded on-chain", tech: "record_liveness" });
    for (const x of will.attestations.slice(p.attestations.length))
      out.push({ text: `${short(x.guardian, 10)} confirmed ${x.kind === "Deceased" ? "a passing" : "they're alive"}`, tech: `attest(${x.kind})` });
    for (const x of will.executions.slice(p.executions.length))
      out.push({ text: `Stage ${x.stage + 1} sent on ${x.chain === "Near" ? "NEAR" : x.chain === "Eth" ? "Sepolia" : "Bitcoin testnet"} to ${short(x.to, 8)}`, tech: "record_execution" });
    for (const x of will.released_notes.slice(p.released_notes.length))
      out.push({ text: `Sealed note "${x.label}" released to ${short(x.heir, 10)}`, tech: "store_released_note" });
    for (const x of will.halted.slice(p.halted.length)) out.push({ text: `Remaining stages and sealed notes stopped: ${haltReason(x.reason)}`, tech: `halt(${x.reason})` });
    if (out.length) {
      const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setEvents((e) => [...e, ...out.map((o) => ({ at, ...o }))].slice(-100));
    }
  }, [will]);
  return events;
}

/** The ladder in plain words for the timeline; raw state names stay in the technical view. */
function describeTransition(a: StateName, b: StateName, will: Will): string {
  const who = short(will.owner, 14);
  if (b === "Active") return `Sign of life: back to All good`;
  switch (b) {
    case "Quiet":
      return `${who} went quiet. Checking in: heartbeat app, email, Telegram, DMs`;
    case "WelfareCheck":
      return "No reply to the checks. Guardians, friends and the lawyer are asked";
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
