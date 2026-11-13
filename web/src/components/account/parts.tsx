"use client";
// Pieces of the owner's account area (creation flow, money, signals, people, notes, alerts), shared by
// the /account screens.
import { humanize, readable, useAccountLabel, useNames } from "@/lib/names";
import { summarizePolicy, type Policy } from "@agent/policy/policy";

import { useState } from "react";
import { AiBadge } from "@/components/Attestation";

import { ActionButton, Card, ErrorNote, Field, inputCls } from "@/components/ui";
import { MyWillSetup, PeopleField } from "@/components/Onboarding";
import { QuietPeriod, realSchedule } from "@/components/QuietPeriod";
import { type DraftNote, FinalSecrets, readyNotes } from "@/components/FinalSecrets";
import { DraftGaps, hasGaps } from "@/components/DraftGaps";

import { agent, type DraftResult } from "@/lib/agent";
import { DEMO_SCHEDULE, REAL_SCHEDULE } from "@/lib/config";
import { stagesFor, summarize } from "@agent/policy/schedule";
import { acceptAsGuardians, addSealedNote, createWill, generateWillAndCast } from "@/lib/demo";
import { keys } from "@/lib/keys";
import { useNow, usePoll } from "@/lib/hooks";
import { topUpAccount } from "@/lib/onboard";
import { balanceOf, formatNear, nearToYocto, signRequest } from "@/lib/near";
import { duration } from "@/lib/will";

/** A wallet account with almost no testnet NEAR can't create a will; offer a free top-up. */
export function LowBalance({ owner }: { owner: string }) {
  const { data: balance, refresh } = usePoll(() => balanceOf(owner), 30_000, [owner]);
  if (balance === null || balance === undefined || balance >= nearToYocto("0.5")) return null;
  return (
    <Card title="This account needs a little testnet NEAR">
      <p className="text-sm text-muted">
        You have {formatNear(balance)} NEAR; a will needs about 1.
      </p>
      <div className="mt-3">
        <ActionButton onClick={async () => (await topUpAccount(owner), refresh())}>Get free testnet NEAR</ActionButton>
      </div>
    </Card>
  );
}

/** Sign-out for a wallet; another sign-in. */
/** useState that survives a reload of this tab (sessionStorage), e.g. a 2-minute AI draft. */
export function useSessionState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setV(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // storage blocked: still works for this page view
    }
  };
  return [v, set];
}

/** Two ways to write it: My will (default) or Will in plain English (drafted by NEAR AI). A sample will is on the speedrun page. */
export function CreateWill(props: { owner: string; onCreating: (b: boolean) => void; onCreated: () => void }) {
  const [mode, setMode] = useSessionState<"generate" | "quick" | "english">(`inheirit:tab:${props.owner}`, "quick");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="How to write your will">
        {(
          [
            ["quick", "My will"],
            ["english", "Will in plain English"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-4 py-2 font-medium ${mode === m ? "bg-accent text-accent-ink" : "border border-line bg-card hover:bg-accent-soft"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode !== "english" ? (
        <MyWillSetup {...props} summary={(stagesPct, demoClock, quietDays) => <SetupSummary stagesPct={stagesPct} demoClock={demoClock} quietDays={quietDays} />} />
      ) : (
        <WriteWill {...props} />
      )}
    </div>
  );
}

/** One click: a test cast (heir, guardians, friend, lawyer) with keys in this browser, and a complete will. */
export function GenerateWill({ owner, onCreating, onCreated }: { owner: string; onCreating: (b: boolean) => void; onCreated: () => void }) {
  const [chains, setChains] = useState({ Eth: true, Btc: true });
  const [demoClock, setDemoClock] = useState(true);
  const [stable, setStable] = useState(false);
  const [deposit, setDeposit] = useState("0.5");
  const [log, setLog] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  return (
    <Card title="Generate sample will">
      <p className="text-sm text-muted">
        Test people (heir, three guardians, friend, lawyer) with keys in this browser, so you play every role. Everything to the heir, 10/20/30/40%,
        plus a sealed note.
      </p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked disabled /> NEAR vault
        </label>
        {(["Eth", "Btc"] as const).map((c) => (
          <label key={c} className="flex items-center gap-2">
            <input type="checkbox" checked={chains[c]} onChange={(e) => setChains({ ...chains, [c]: e.target.checked })} />
            {c === "Eth" ? "Ethereum vault" : "Bitcoin vault"}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={stable} onChange={(e) => setStable(e.target.checked)} /> Pay the heir in dollars (NEAR Intents, SIMULATED on testnet)
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <Field label="NEAR to put in the vault now">
          <input className={`${inputCls} w-28`} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={demoClock} onChange={(e) => setDemoClock(e.target.checked)} />
          Demo clock (minutes instead of months)
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">
        Ethereum and Bitcoin test coins come from a small pool while it lasts; otherwise only NEAR moves.
      </p>
      <div className="mt-3">
        <SetupSummary stagesPct={[10, 20, 30, 40]} demoClock={demoClock} />
      </div>
      <div className="mt-3">
        <ActionButton
          onClick={async () => {
            setLog([]);
            setFailed(false);
            // Nothing is created while the agent is down: a will without it would be left half-made.
            await agent.info();
            onCreating(true);
            try {
              await generateWillAndCast(
                owner,
                {
                  schedule: demoClock ? DEMO_SCHEDULE : REAL_SCHEDULE,
                  foreignChains: [...(chains.Eth ? ["Eth" as const] : []), ...(chains.Btc ? ["Btc" as const] : [])],
                  depositNear: deposit,
                  stable,
                },
                (m) => setLog((l) => [...l, m]),
              );
              onCreated();
              onCreating(false);
            } catch (e) {
              // Stay on this view so the log and the error stay visible; the will may already exist.
              setFailed(true);
              throw e;
            }
          }}
        >
          Generate my will
        </ActionButton>
        {failed && (
          <ActionButton tone="quiet" className="ml-2" onClick={async () => (onCreating(false), onCreated())}>
            Go to my dashboard anyway
          </ActionButton>
        )}
      </div>
      <ul className="mt-3 font-mono text-xs text-muted">
        {log.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </Card>
  );
}

export function WriteWill({ owner, onCreating, onCreated }: { owner: string; onCreating: (b: boolean) => void; onCreated: () => void }) {
  const names = useNames();
  const label = useAccountLabel();
  const [text, setText] = useSessionState(`inheirit:draft-text:${owner}`, "");
  const [draft, setDraft] = useSessionState<DraftResult | null>(`inheirit:draft:${owner}`, null);
  const [draftingSince, setDraftingSince] = useState<number | null>(null);
  const now = useNow();
  const demoClock = false; // a speedrun is started later from My will
  const [notes, setNotes] = useState<DraftNote[]>([]);
  const [notesOnly, setNotesOnly] = useState(false);
  const [quietDays, setQuietDays] = useState<number | null>(null);
  const [contacts, setContacts] = useState("");
  const [deposit, setDeposit] = useState("0.5");
  const [log, setLog] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  // A draft with gaps (no NEAR accounts, guardians as bare names…) is completed below, then re-checked.
  const [filled, setFilled] = useState<{ policy: Policy | null; errors: string[] }>({ policy: null, errors: [] });
  const gaps = !!draft && !draft.ok && hasGaps(draft.draft);
  const policy = draft?.ok ? (draft.policy as Policy) : gaps ? filled.policy : null;
  const assets = new Set(policy?.allocations.map((a) => a.asset));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Card title="Write it in plain English">
        <p className="mb-3 text-sm text-muted">
          Who gets what, and who your guardians are. Nothing is saved until you approve the summary.
        </p>
        <textarea
          aria-label="Your will in plain English"
          className={`${inputCls} h-40 w-full`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Everything to my son Tobi. My guardians are Ada and Ben; both must confirm."
        />
        <div className="mt-3">
          <ActionButton
            disabled={text.trim().length < 10}
            onClick={async () => {
              setDraft(null);
              setFilled({ policy: null, errors: [] });
              setDraftingSince(Math.floor(Date.now() / 1000));
              try {
                setDraft(await agent.draftPolicy(await signRequest(owner, "draft_policy", { text })));
              } finally {
                setDraftingSince(null);
              }
            }}
          >
            Draft my will
          </ActionButton>
          {draftingSince !== null && (
            <span className="ml-3 text-xs text-muted">
              Usually 1–2 min · {Math.floor((now - draftingSince) / 60)}:{String((now - draftingSince) % 60).padStart(2, "0")}
            </span>
          )}
        </div>
        {gaps && (
          <>
            <DraftGaps owner={owner} draft={draft!.draft as never} onReady={(p, errors) => setFilled({ policy: p, errors })} />
            {filled.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-danger">
                {filled.errors.map((e) => (
                  <li key={e}>{humanize(e, names)}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {draft && !draft.ok && !gaps && (
          <div className="mt-4 space-y-2">
            <ErrorNote>Say who inherits, e.g. “Half to Sam, half to Samantha. My guardians are Hamed and James.”</ErrorNote>
          </div>
        )}
        {policy && (
          <div className="mt-4 space-y-3">
            <h3 className="font-serif text-lg">Please check this summary</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {summarizePolicy(policy).map((l) => (
                <li key={l}>{readable(l, names)}</li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              Written by our code, not the model. Model answer:{" "}
              {draft?.ai.signature?.ok ? "signature verified" : "signature not verified"}{draft?.ok ? "" : "; missing details added by you"}.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Friends for a welfare check (optional)" group hint="Can only stop it, never start it.">
                <PeopleField owner={owner} what="friend" value={contacts} onChange={setContacts} label={label} />
              </Field>
              <Field label="NEAR to put in the vault now">
                <input className={inputCls} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </Field>
            </div>
            <QuietPeriod owner={owner} value={quietDays} onChange={setQuietDays} />
            <SetupSummary stagesPct={policy.stages_pct} demoClock={demoClock} quietDays={quietDays} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={notesOnly} onChange={(e) => setNotesOnly(e.target.checked)} />
              <span>
                <b>Notes only, no vaults</b>: nothing held for you; only sealed notes, released last.
              </span>
            </label>
            <h3 className="font-serif text-lg">Final secrets {notesOnly ? "" : "(optional)"}</h3>
            <FinalSecrets heirs={policy.heirs.map((h) => ({ account: h.near_account, name: h.name }))} notes={notes} onChange={setNotes} />
            <ActionButton
              disabled={notesOnly && !readyNotes(notes).length}
              onClick={async () => {
                setLog([]);
                setFailed(false);
                onCreating(true);
                try {
                  await createWill(
                  owner,
                  {
                    policy,
                    contacts: contacts.split(",").map((c) => c.trim()).filter(Boolean),
                    schedule: demoClock ? DEMO_SCHEDULE : realSchedule(quietDays),
                    foreignChains: notesOnly ? [] : [...(assets.has("ETH") ? ["Eth" as const] : []), ...(assets.has("BTC") ? ["Btc" as const] : [])],
                    depositNear: notesOnly ? "0" : deposit,
                  },
                  (m) => setLog((l) => [...l, m]),
                );
                  for (const n of readyNotes(notes)) {
                    setLog((l) => [...l, `Sealing “${n.label}” in this browser…`]);
                    await addSealedNote(owner, n.heir, n.label.trim(), n.text);
                  }
                  // Test guardians generated here hold their keys in this browser: they accept at once.
                  const local = policy.guardians.filter((g) => keys.secret(g));
                  if (local.length) await acceptAsGuardians(owner, local, (m) => setLog((l) => [...l, m]));
                  onCreated();
                  onCreating(false);
                } catch (e) {
                  setFailed(true);
                  throw e;
                }
              }}
            >
              Approve and create my will
            </ActionButton>
            {failed && (
              <ActionButton tone="quiet" className="ml-2" onClick={async () => (onCreating(false), onCreated())}>
                Go to my dashboard anyway
              </ActionButton>
            )}
            <ul className="font-mono text-xs text-muted">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card title="Private by construction">
        <AiBadge />
        <p className="mt-3 text-sm text-muted">
          Your words go only to an attested enclave model. Unsigned answers are discarded.
        </p>
      </Card>
    </div>
  );
}

/** Decimal string → smallest units (wei or sats), without floating point. */
export function toUnits(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.trim().split(".");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(frac) || frac.length > decimals) throw new Error(`"${value}" is not an amount`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** "If you go quiet: earliest anything moves ≈ X; full distribution ≈ Y; secrets ≈ Z." (CLAUDE.md §8) */
export function SetupSummary({ stagesPct, demoClock, quietDays = null }: { stagesPct: number[]; demoClock: boolean; quietDays?: number | null }) {
  const preset = demoClock ? DEMO_SCHEDULE : realSchedule(quietDays);
  const sum = summarize(preset.timings, stagesFor(stagesPct, preset));
  return (
    <p className="rounded-md border border-line bg-accent-soft p-3 text-sm">
      If you go quiet: first slice ≈ <b>{duration(sum.earliestMove)}</b>, all handed over ≈{" "}
      <b>{duration(sum.fullDistribution)}</b>, notes ≈ <b>{duration(sum.secrets)}</b>. A sign of life stops it.
    </p>
  );
}
