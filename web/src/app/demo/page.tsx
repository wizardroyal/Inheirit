"use client";
// Demo control panel for judges (CLAUDE.md §8): demo tooling, not part of the product.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AgentBadge } from "@/components/Attestation";
import { Ladder } from "@/components/Ladder";
import { ActionButton, Card, Details, ExtLink, Pill, short, SimulatedTag } from "@/components/ui";
import { NotificationLog, Releases, SignalList, WatchStatus } from "@/components/WillParts";
import { agent, type SignalSource } from "@/lib/agent";
import { CONTRACT_ID, DEMO_TIMINGS, explorer } from "@/lib/config";
import { addSealedNote, createCast, createWill, DEMO_NOTE, demoPolicy } from "@/lib/demo";
import { useKeys, usePoll, useWill } from "@/lib/hooks";
import type { Cast } from "@/lib/keys";
import { call, formatNear, signRequest } from "@/lib/near";
import { ago, stateName, type Will } from "@/lib/will";

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
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-serif text-3xl">Demo control panel</h1>
          <Pill tone="warn">demo tooling</Pill>
        </div>
        <p className="max-w-3xl text-muted">
          Everything here uses throwaway testnet accounts created in your browser from the public faucet. The clock is compressed: a will goes quiet
          after {DEMO_TIMINGS.quiet_after / 60} minutes of silence instead of weeks. Follow Scenario A (silence doesn&apos;t kill you) or Scenario B (it
          actually executes).
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Pill>contract {CONTRACT_ID}</Pill>
          {root ? <Pill tone={root.demoMode ? "accent" : "warn"}>agent online{root.demoMode ? ", demo mode" : ", demo mode OFF"}</Pill> : null}
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
            Creates a funded account from the testnet faucet, then Alice (owner), Bola (heir), three guardians and a friend under it. Takes about 20
            seconds.
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
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-line bg-bg px-2 py-1 text-sm">
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
        <div key={k} className="flex justify-between gap-2 border-b border-line py-1">
          <dt className="text-muted">{k}</dt>
          <dd className="truncate">
            <ExtLink href={explorer.nearAccount(v)}>{v}</ExtLink>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ProgressLog({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="mt-3 space-y-0.5 font-mono text-xs text-muted">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

function WillPanel({ cast }: { cast: Cast }) {
  const { data: will, loaded, refresh } = useWill(cast.owner, 4000);
  const [chains, setChains] = useState<{ Eth: boolean; Btc: boolean }>({ Eth: true, Btc: true });
  const [withNote, setWithNote] = useState(true);
  // Keep the setup view until every step has finished, even after the will shows up on-chain
  const [creating, setCreating] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const progress = (m: string) => setLog((l) => [...l, m]);
  const events = useEventLog(will ?? null);

  if (!loaded) return <Card>Loading…</Card>;
  if (!will || creating)
    return (
      <Card title="2 · Write the demo will">
        <p className="text-sm text-muted">
          Alice leaves everything to Bola, released in three stages (10%, 30%, 60%). Two of three guardians must confirm. 1 NEAR goes into the
          NEAR vault; the Sepolia and BTC vaults are addresses derived by Chain Signatures, which you can fund from a faucet.
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
                  policy: demoPolicy(cast),
                  contacts: [cast.contact],
                  timings: DEMO_TIMINGS,
                  foreignChains: (["Eth", "Btc"] as const).filter((c) => chains[c]),
                  depositNear: "1",
                },
                progress,
              );
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
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-6">
        <Card title="Where the will is" aside={<Link href={`/owner?as=${cast.owner}`} className="text-sm text-accent underline">owner view</Link>}>
          <WatchStatus owner={cast.owner} will={will} canSign />
          <Ladder will={will} />
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton tone="quiet" disabled={done} onClick={() => call(cast.funder, "advance", { owner: cast.owner }).then(refresh)}>
              Advance now (if due)
            </ActionButton>
          </div>
          <p className="mt-2 text-xs text-muted">The agent advances the will on its own every 15 s. Anyone may call advance; it only moves if the time has passed.</p>
        </Card>

        <Card title="Signs of life">
          <p className="mb-3 text-sm text-muted">Stop everything and the will escalates. Then try to stop it:</p>
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
              <ActionButton key={x.source} tone="quiet" disabled={done} onClick={() => agent.simulate(cast.owner, x.source)}>
                {x.label}
              </ActionButton>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            A single X or Instagram post is ignored on purpose (someone else could be running the account). Two weak sources within 24 h, or any
            strong one, count. The agent checks every 15 s.
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
                    <ActionButton tone="danger" disabled={s !== "GuardianVote" || !!a} onClick={() => call(g, "attest", { owner: cast.owner, kind: "Deceased", evidence_hash: null }).then(refresh)}>
                      Confirm passing
                    </ActionButton>
                    <ActionButton tone="quiet" disabled={s !== "GuardianVote" || !!a} onClick={() => call(g, "attest", { owner: cast.owner, kind: "Alive", evidence_hash: null }).then(refresh)}>
                      Alive
                    </ActionButton>
                  </span>
                </li>
              );
            })}
            <li className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <span>Friend {short(cast.contact, 14)}</span>
              <ActionButton tone="quiet" disabled={s !== "Quiet" && s !== "WelfareCheck"} onClick={() => call(cast.contact, "contact_confirm_alive", { owner: cast.owner }).then(refresh)}>
                “I heard from Alice”
              </ActionButton>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted">
            Guardians can act only during the vote; the friend only during Quiet or the welfare check. Full pages:{" "}
            <Link className="text-accent underline" href={`/guardian/${cast.owner}`}>guardian</Link>,{" "}
            <Link className="text-accent underline" href={`/heir/${cast.owner}`}>heir</Link>.
          </p>
        </Card>
      </div>

      <div className="space-y-6">
        <Vaults owner={cast.owner} will={will} />
        <Card title="Released so far">
          <Releases will={will} />
        </Card>
        <Card title="Event log" aside={<span className="text-xs text-muted">as seen by this page</span>}>
          {events.length === 0 && <p className="text-sm text-muted">Waiting for changes…</p>}
          <ul className="space-y-1 text-sm">
            {[...events].reverse().map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-16 shrink-0 text-xs text-muted">{e.at}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Notifications sent by the agent">
          <NotificationLog owner={cast.owner} />
        </Card>
        <Card title="Trust">
          <AgentBadge />
        </Card>
      </div>
    </div>
  );
}

function Vaults({ owner, will }: { owner: string; will: Will }) {
  const { data, error } = usePoll(() => agent.vaults(owner), 20_000, [owner]);
  return (
    <Card title="Vaults">
      <ul className="space-y-2 text-sm">
        <li className="flex justify-between gap-2">
          <span>NEAR (held by the contract)</span>
          <span>{formatNear(will.near_balance)} NEAR</span>
        </li>
        {will.foreign_chains.map((c) => {
          const v = data?.[c];
          const ok = v && "address" in v;
          return (
            <li key={c} className="space-y-0.5">
              <div className="flex justify-between gap-2">
                <span>{c === "Eth" ? "Sepolia ETH" : "BTC testnet4"}</span>
                <span>{ok ? (c === "Eth" ? `${(Number(v.balance) / 1e18).toFixed(5)} ETH` : `${v.balance} sats`) : v ? "error" : "…"}</span>
              </div>
              {ok && (
                <div className="text-xs text-muted">
                  <ExtLink href={c === "Eth" ? explorer.ethAddress(v.address) : explorer.btcAddress(v.address)}>{v.address}</ExtLink>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Details summary="How to fund the Sepolia and BTC vaults">
        <div className="font-sans">
          These addresses are derived by NEAR Chain Signatures from the contract account and the path heirloom/&lt;owner&gt;/&lt;chain&gt;. Only the
          contract can have them signed, and only while the will is executing (or for an owner withdrawal). Send a little Sepolia ETH or testnet4 BTC
          from any faucet before execution starts; an empty vault is simply skipped. BTC balance counts confirmed coins only.
        </div>
      </Details>
      {error && <p className="text-xs text-danger">{error}</p>}
      {will.foreign_chains.length === 0 && <p className="mt-2 text-xs text-muted">This will has no foreign vaults.</p>}
    </Card>
  );
}

/** Turns successive will snapshots into a readable log of what changed. */
function useEventLog(will: Will | null) {
  const prev = useRef<Will | null>(null);
  const [events, setEvents] = useState<{ at: string; text: string }[]>([]);
  useEffect(() => {
    if (!will) return;
    const p = prev.current;
    prev.current = will;
    if (!p) return;
    const out: string[] = [];
    const a = stateName(p.state);
    const b = stateName(will.state);
    if (a !== b || JSON.stringify(p.state) !== JSON.stringify(will.state)) {
      if (a === b && b === "Executing") out.push(`Stage ${(will.state as { Executing: { stage: number } }).Executing.stage + 1} started`);
      else out.push(`${a} → ${b}`);
    }
    if (will.last_alive_at > p.last_alive_at) out.push("Sign of life recorded on-chain");
    for (const x of will.attestations.slice(p.attestations.length)) out.push(`${short(x.guardian, 10)} attested ${x.kind}`);
    for (const x of will.executions.slice(p.executions.length)) out.push(`Released ${x.chain} stage ${x.stage + 1} to ${short(x.to, 8)}`);
    for (const x of will.released_notes.slice(p.released_notes.length)) out.push(`Note "${x.label}" re-sealed to ${short(x.heir, 10)}`);
    for (const x of will.halted.slice(p.halted.length)) out.push(`Execution halted: ${x.reason}`);
    if (out.length) {
      const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setEvents((e) => [...e, ...out.map((text) => ({ at, text }))].slice(-100));
    }
  }, [will]);
  return events;
}

