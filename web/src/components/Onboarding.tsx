"use client";
// Progressive onboarding (CLAUDE.md §8): a minimum will in 3 steps (signals, people, vault) with a
// live allocation preview, then a will-strength checklist. Percentages, not amounts; sign-up asks
// only for a display name (jurisdiction optional), both kept in the off-chain policy.
import { useEffect, useRef, useState } from "react";
import { checkPolicy, summarizePolicy, type Policy } from "@agent/policy/policy";
import { STANDARD_PCT } from "@agent/policy/schedule";
import { agent } from "@/lib/agent";
import { DEMO_SCHEDULE } from "@/lib/config";
import { acceptAsGuardians, addSealedNote, createWill } from "@/lib/demo";
import { keys } from "@/lib/keys";
import { createPerson } from "@/lib/onboard";
import { newTestReceive, testReceiveFor } from "@/lib/test-wallets";
import { humanize, nameOf, readable, useAccountLabel, useNames } from "@/lib/names";
import { QuietPeriod, realSchedule } from "./QuietPeriod";
import { type DraftNote, FinalSecrets, readyNotes } from "./FinalSecrets";
import { ActionButton, Avatar, Card, Field, inputCls, SimulatedTag, Stepper } from "./ui";
import { localProfile, newId, saveProfile, useProfile, type Person, type Role } from "@/lib/profile";

const ACCOUNT = /^[a-z0-9._-]{2,64}$/;

/** A saved draft of this form (round 5); sealed notes are never part of it. */
interface DraftForm {
  v: 1;
  name: string;
  jurisdiction: string;
  evm: string;
  heirs: HeirRow[];
  guardians: string;
  threshold: string;
  lawyer: string;
  contacts: string;
  assets: { ETH: boolean; BTC: boolean };
  deposit: string;
  notesOnly: boolean;
  speedrun: boolean;
  quietDays: number | null;
  stable: boolean;
}

interface HeirRow {
  name: string;
  account: string;
  pct: string;
  eth: string;
  btc: string;
}

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** A chosen person, shown as a row by name (round 5: rows, never small pills); the account id stays out of sight. */
function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex w-full items-center gap-3 rounded-lg border border-line bg-card px-3 py-1">
      <Avatar name={label} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button type="button" aria-label={`Remove ${label}`} className="min-h-11 px-3 text-muted underline hover:text-ink" onClick={onRemove}>
        Remove
      </button>
    </span>
  );
}

/** The "generate" mark: a circular arrow. */
export function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`inline-block align-[-3px] ${className}`} aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** A square button the height of an input, showing the refresh mark. */
export function RefreshButton({ label, busy, onClick }: { label: string; busy?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={busy}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-field bg-card text-accent hover:bg-accent-soft disabled:opacity-50"
      onClick={onClick}
    >
      <RefreshIcon className={busy ? "animate-spin" : ""} />
    </button>
  );
}

/** Creates a funded test person (random name, key in this browser) for this role. */
export function GenerateButton({ owner, what, name, onMade }: { owner: string; what: string; name?: string; onMade: (p: { accountId: string; name: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 flex-col items-end">
      <RefreshButton
        label={`Generate a test ${what}`}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            onMade(await createPerson(owner, name));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <span className="max-w-48 text-xs text-danger">{error}</span>}
    </span>
  );
}

/**
 * The NEAR account for someone picked from Profile. People saved by name only get a funded test account
 * (testnet), which is written back to their Profile row so the next pick reuses it.
 */
async function accountFor(owner: string, p: Person): Promise<{ accountId: string; created: boolean }> {
  if (p.account) return { accountId: p.account, created: false };
  const made = await createPerson(owner, p.name);
  const all = localProfile(owner).people;
  await saveProfile(owner, { people: all.map((x) => (x.id === p.id ? { ...x, account: made.accountId } : x)) }).catch(() => {});
  return { accountId: made.accountId, created: true };
}

/** A comma-separated list of NEAR accounts shown as name chips, with a box to add one and a refresh button to generate one. */
export function PeopleField({
  owner,
  what,
  value,
  onChange,
  label,
  single,
}: {
  owner: string;
  what: string;
  value: string;
  onChange: (v: string) => void;
  label: (id: string) => string;
  single?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const people = list(value);
  const [profile] = useProfile(owner);
  const role = (["guardian", "lawyer", "friend", "heir"] as Role[]).find((r) => r === what) ?? "guardian";
  // People already in Profile for this role, not yet chosen here (someone saved by name only gets a test account on pick).
  const fromProfile = profile.people.filter((p) => p.role === role && !(p.account && people.includes(p.account)));
  const add = (id: string, name?: string) => {
    if (!id || people.includes(id)) return;
    onChange((single ? [id] : [...people, id]).join(", "));
    setDraft("");
    // Added here → saved to Profile too.
    const all = localProfile(owner).people;
    if (!all.some((p) => p.account === id)) saveProfile(owner, { people: [...all, { id: newId(), name: name ?? label(id), role, account: id }] }).catch(() => {});
  };
  return (
    <div className="space-y-2">
      {(!single || people.length === 0) && fromProfile.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fromProfile.map((p) => (
            <ActionButton key={p.id} tone="quiet" className="border-dashed" onClick={async () => add((await accountFor(owner, p)).accountId, p.name)}>
              + {p.name}
            </ActionButton>
          ))}
        </div>
      )}
      {people.length > 0 && (
        <div className="space-y-2">
          {people.map((p) => (
            <Chip key={p} label={label(p)} onRemove={() => onChange(people.filter((x) => x !== p).join(", "))} />
          ))}
        </div>
      )}
      {(!single || people.length === 0) && (
        <span className="flex items-start gap-2">
          <input
            className={`${inputCls} min-w-0 flex-1`}
            value={draft}
            onChange={(e) => setDraft(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(draft);
              }
            }}
            onBlur={() => add(draft)}
            aria-label={`Add a ${what} by NEAR account`} placeholder="NEAR account, or tap ↻"
          />
          <GenerateButton owner={owner} what={what} onMade={(p) => add(p.accountId, p.name)} />
        </span>
      )}
    </div>
  );
}

/** Where the owner is in setup: the steps, done ones ticked, and a bar. Backing up comes right after creation. */
function SetupProgress({ steps }: { steps: [string, boolean][] }) {
  const done = steps.filter(([, d]) => d).length;
  return (
    <div className="sticky top-0 z-10 -mx-1 rounded-xl bg-bg/95 px-1 py-3 backdrop-blur">
      <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {steps.map(([label, d], i) => (
          <li key={label} className={d ? "text-accent" : "text-muted"}>
            {d ? "✓" : `${i + 1}.`} {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MyWillSetup({
  owner,
  onCreating,
  onCreated,
  summary,
}: {
  owner: string;
  onCreating: (b: boolean) => void;
  onCreated: () => void;
  summary: (stagesPct: number[], demoClock: boolean, quietDays: number | null) => React.ReactNode;
}) {
  // The random username reads better with spaces: "ThistleProudJump" → "Thistle Proud Jump".
  const [name, setName] = useState(() => (nameOf(owner) ?? "").replace(/([a-z])([A-Z])/g, "$1 $2"));
  // Errors stay grey until the owner has changed something: a fresh form shouldn't open in red.
  const [touched, setTouched] = useState(false);
  const [jurisdiction, setJurisdiction] = useState("");
  const [evm, setEvm] = useState("");
  const [heirs, setHeirs] = useState<HeirRow[]>([{ name: "", account: "", pct: "100", eth: "", btc: "" }]);
  const [guardians, setGuardians] = useState("");
  const [threshold, setThreshold] = useState("2");
  const [lawyer, setLawyer] = useState("");
  const [contacts, setContacts] = useState("");
  const [assets, setAssets] = useState({ ETH: false, BTC: false });
  const [deposit, setDeposit] = useState("0.5");
  // Notes only: no money in any vault, just sealed notes released last (the zero-custody way in).
  // Notes-only wills were dropped from setup (2026-11-13); old drafts load as normal wills.
  const notesOnly = false;
  const [notes, setNotes] = useState<DraftNote[]>([]);
  // Setup always uses real timings; a speedrun is started later from My will.
  const demoClock = false;
  const [quietDays, setQuietDays] = useState<number | null>(60);
  const [stable, setStable] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  // The demo faucet pool's addresses: the first generated heir receives there, so test coins come back.
  // A ref, so a click that lands before or after the answer always reads the latest value.
  const pool = useRef<{ eth: string; btc: string } | null>(null);
  useEffect(() => {
    agent
      .faucetInfo()
      .then((f) => (pool.current = f.enabled ? { eth: f.eth, btc: f.btc } : null))
      .catch(() => (pool.current = null));
  }, []);

  // Draft (round 5): the form is kept with the agent, off-chain, until Start. Secrets are never in it.
  const [profile] = useProfile(owner);
  const loadedDraft = useRef(false);
  useEffect(() => {
    const d = profile.draft as DraftForm | { v: 0; assets: { ETH: boolean; BTC: boolean } } | undefined;
    if (loadedDraft.current || !d) return;
    loadedDraft.current = true;
    // Setup's vault step saved only the chains.
    if (d.v === 0) return setAssets(d.assets);
    setName(d.name);
    setJurisdiction(d.jurisdiction);
    setEvm(d.evm);
    setHeirs(d.heirs.length ? d.heirs : [{ name: "", account: "", pct: "100", eth: "", btc: "" }]);
    setGuardians(d.guardians);
    setThreshold(d.threshold);
    setLawyer(d.lawyer);
    setContacts(d.contacts);
    setAssets(d.assets);
    setDeposit(d.deposit);
    setQuietDays(d.quietDays);
    setStable(d.stable);
  }, [profile.draft]);
  const [draftSaved, setDraftSaved] = useState(false);
  const draftForm = (): DraftForm => ({ v: 1, name, jurisdiction, evm, heirs, guardians, threshold, lawyer, contacts, assets, deposit, notesOnly, speedrun: false, quietDays, stable });
  const profileHeirs = profile.people.filter((p) => p.role === "heir" && !(p.account && heirs.some((h) => h.account === p.account)));

  const label = useAccountLabel();
  const names = useNames();
  const guardianList = list(guardians);
  const badAccounts = [...heirs.map((h) => h.account), ...guardianList, ...(lawyer ? [lawyer] : []), ...list(contacts)].filter((a) => a && !ACCOUNT.test(a));
  const ids = heirs.map((_, i) => `h${i + 1}`);
  const shares = Object.fromEntries(heirs.map((h, i) => [ids[i], Number(h.pct) || 0]));
  const check = checkPolicy({
    version: 1,
    owner,
    heirs: heirs.map((h, i) => ({
      id: ids[i],
      name: h.name.trim(),
      near_account: h.account.trim(),
      receive: { ...(assets.ETH && h.eth.trim() ? { eth: h.eth.trim() } : {}), ...(assets.BTC && h.btc.trim() ? { btc: h.btc.trim() } : {}) },
    })),
    allocations: [
      { asset: "NEAR", shares },
      ...(assets.ETH ? [{ asset: "ETH", shares }] : []),
      ...(assets.BTC ? [{ asset: "BTC", shares }] : []),
    ],
    stages_pct: STANDARD_PCT,
    guardians: guardianList,
    guardian_threshold: Number(threshold) || 0,
    contacts: list(contacts),
    ...(lawyer.trim() ? { lawyer: lawyer.trim() } : {}),
    ...(name.trim() ? { display_name: name.trim() } : {}),
    ...(jurisdiction.trim() ? { jurisdiction: jurisdiction.trim() } : {}),
    ...(stable ? { payout_value_mode: "stable" } : {}),
  });
  const deposit_ = Number(deposit);
  const errors = [
    ...new Set([
      ...(name.trim() ? [] : ["Add your display name."]),
      ...(guardianList.length < 2 ? ["Choose at least two guardians."] : []),
      ...badAccounts.map((a) => `“${a}” isn't a valid NEAR account name.`),
      ...(notesOnly || (Number.isFinite(deposit_) && deposit_ > 0 && deposit_ <= 1000) ? [] : ["Put between 0 and 1,000 NEAR in the vault."]),
      ...(notesOnly && !readyNotes(notes).length ? ["A notes-only will needs at least one note (heir, title and text)."] : []),
      // The checker's own guardian-count messages repeat the line above.
      ...(check.ok ? [] : check.errors.filter((e) => !(guardianList.length < 2 && /guardian/i.test(e) && !/heir|own guardian|twice/.test(e)))),
    ]),
  ];
  const policy = check.ok && !errors.length ? (check.policy as Policy) : null;
  const pctTotal = heirs.reduce((s, h) => s + (Number(h.pct) || 0), 0);

  const setHeir = (i: number, patch: Partial<HeirRow>) => setHeirs((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  return (
    <div className="space-y-6" onChangeCapture={() => setTouched(true)} onClickCapture={(e) => (e.target as HTMLElement).closest("button") && setTouched(true)}>
      <SetupProgress
        steps={[
          ["Who gets what", heirs.some((h) => h.account.trim() && h.name.trim())],
          ["Who confirms", list(guardians).length >= 2],
          ["Vault", Number(deposit) > 0],
          ["Release", true],
          ["Final secrets", readyNotes(notes).length > 0],
          ["Save your recovery key", false],
          ["Review", !!policy],
        ]}
      />
      <Card title="About you">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name" hint="Shown to heirs and guardians.">
            <input className={inputCls} maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" />
          </Field>
          <Field label="Country or state (optional)" hint="That's all we ask.">
            <input className={inputCls} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="Nigeria" />
          </Field>
        </div>
      </Card>

      <Card title="1 · The people">
        <p className="text-sm text-muted">Nothing can start until enough guardians accept.</p>
        <p className="mb-3 mt-1 text-sm text-muted">
          Tap <RefreshIcon className="text-accent" /> to generate a test heir or guardian.
        </p>
        <div className="space-y-3">
          {heirs.map((h, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1.4fr_5rem_auto]">
              <input className={`${inputCls} min-w-0`} maxLength={64} value={h.name} onChange={(e) => setHeir(i, { name: e.target.value })} aria-label="Heir's name" placeholder="Heir's name" />
              <span className="flex items-start gap-2">
                {h.account && keys.secret(h.account) ? (
                  <span className="self-center">
                    <Chip label={`${label(h.account)} · test account`} onRemove={() => setHeir(i, { account: "" })} />
                  </span>
                ) : (
                  <input className={`${inputCls} min-w-0 flex-1`} value={h.account} onChange={(e) => setHeir(i, { account: e.target.value.trim() })} aria-label="Heir's NEAR account" placeholder="Their NEAR account" />
                )}
                <GenerateButton
                  owner={owner}
                  what="heir"
                  name={h.name.trim() || undefined}
                  onMade={(p) =>
                    setHeirs((hs) =>
                      hs.map((x, j) => {
                        if (j !== i) return x;
                        const recv = testReceiveFor(hs.filter((_, k) => k !== i).map((o) => o.eth), pool.current);
                        return { ...x, account: p.accountId, name: x.name || p.name, eth: x.eth || recv.eth, btc: x.btc || recv.btc };
                      }),
                    )
                  }
                />
              </span>
              <span className="relative">
                <input className={`${inputCls} w-full pr-7`} inputMode="decimal" value={h.pct} onChange={(e) => setHeir(i, { pct: e.target.value })} aria-label="Share in percent" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
              </span>
              {heirs.length > 1 ? (
                <ActionButton tone="quiet" onClick={async () => setHeirs((hs) => hs.filter((_, j) => j !== i))}>
                  Remove
                </ActionButton>
              ) : (
                <span />
              )}
              {(assets.ETH || assets.BTC) && (
                <span className="flex flex-col gap-2 sm:col-span-4 sm:flex-row sm:items-start">
                  {assets.ETH && (
                    <input className={`${inputCls} min-w-0 flex-1`} value={h.eth} onChange={(e) => setHeir(i, { eth: e.target.value.trim() })} aria-label="Heir's Ethereum address" placeholder="Receives ETH at 0x…" />
                  )}
                  {assets.BTC && (
                    <input className={`${inputCls} min-w-0 flex-1`} value={h.btc} onChange={(e) => setHeir(i, { btc: e.target.value.trim() })} aria-label="Heir's Bitcoin testnet address" placeholder="Receives BTC at tb1…" />
                  )}
                  <RefreshButton
                    label="Generate test addresses for this heir"
                    onClick={() => {
                      const recv = newTestReceive();
                      setHeir(i, { eth: recv.eth, btc: recv.btc });
                    }}
                  />
                </span>
              )}
            </div>
          ))}
          {(assets.ETH || assets.BTC) && (
            <p className="text-xs text-muted">
              Tip: <b>Pay heirs in dollars</b> and each heir needs one address. Intents converts every slice to USDC.
            </p>
          )}
          {profileHeirs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">From your people:</span>
              {profileHeirs.map((p) => (
                <ActionButton
                  key={p.id}
                  tone="quiet"
                  className="border-dashed"
                  onClick={async () => {
                    const { accountId, created } = await accountFor(owner, p);
                    setHeirs((hs) => {
                      // A new test account also gets test receive addresses, like ↻.
                      const recv = created ? testReceiveFor(hs.map((o) => o.eth), pool.current) : { eth: "", btc: "" };
                      const row = { name: p.name, account: accountId, pct: "0", eth: p.eth || recv.eth, btc: p.btc || recv.btc };
                      const empty = hs.findIndex((h) => !h.name.trim() && !h.account.trim());
                      return empty >= 0 ? hs.map((h, j) => (j === empty ? { ...row, pct: h.pct } : h)) : [...hs, row];
                    });
                  }}
                >
                  + {p.name}
                </ActionButton>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 text-sm">
            <ActionButton tone="quiet" onClick={async () => setHeirs((hs) => [...hs, { name: "", account: "", pct: "0", eth: "", btc: "" }])}>
              Add an heir
            </ActionButton>
            <span className={pctTotal === 100 ? "text-muted" : "text-danger"}>shares add up to {pctTotal}%</span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Guardians" group hint="At least two. Not heirs.">
            <PeopleField owner={owner} what="guardian" value={guardians} onChange={setGuardians} label={label} />
          </Field>
          <Field label="How many must confirm" group>
            <Stepper label="guardians who must confirm" value={Number(threshold) || 1} min={1} max={Math.max(1, guardianList.length)} onChange={(n) => setThreshold(String(n))} />
          </Field>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Lawyer (optional)" group hint="Can speed up the release, never skip the challenge period.">
            <PeopleField owner={owner} what="lawyer" value={lawyer} onChange={setLawyer} label={label} single />
          </Field>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Friends for a welfare check (optional)" group hint="Can only stop it, never start it.">
            <PeopleField owner={owner} what="friend" value={contacts} onChange={setContacts} label={label} />
          </Field>
        </div>
      </Card>

      <Card title="2 · The vault">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked disabled /> NEAR
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={assets.ETH} onChange={(e) => setAssets({ ...assets, ETH: e.target.checked })} /> Ethereum
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={assets.BTC} onChange={(e) => setAssets({ ...assets, BTC: e.target.checked })} /> Bitcoin
          </label>
        </div>
        <div className="mt-3 max-w-xs">
          <Field label="NEAR to put in the vault now">
            <input className={inputCls} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </Field>
        </div>
        {(assets.ETH || assets.BTC) && <p className="mt-2 text-sm text-muted">Fund Ethereum and Bitcoin from the Vault page once the will is started.</p>}
      </Card>

      <Card title="3 · The release">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={stable} onChange={(e) => setStable(e.target.checked)} />
          <span>
            <b>Pay heirs in dollars</b>: each slice is paid as USDC, using NEAR Intents on mainnet. <SimulatedTag /> on testnet.
          </span>
        </label>
        <div className="mt-4">
          <QuietPeriod owner={owner} evm={evm} value={quietDays} onChange={setQuietDays} />
        </div>
        <div className="mt-2">{summary(STANDARD_PCT, demoClock, quietDays)}</div>
      </Card>

      <Card title="4 · Final secrets (optional)">
        {!heirs.some((h) => h.account.trim()) && <p className="text-sm text-muted">Add an heir first; each secret is for one heir.</p>}
        <FinalSecrets heirs={heirs.filter((h) => h.account).map((h) => ({ account: h.account.trim(), name: h.name }))} notes={notes} onChange={setNotes} />
      </Card>

      <Card title="Check and approve">
        {errors.length > 0 ? (
          <ul className={`list-disc space-y-1 pl-5 text-sm ${touched ? "text-danger" : "text-muted"}`}>
            {errors.map((e) => (
              <li key={e}>{humanize(e, names)}</li>
            ))}
          </ul>
        ) : (
          policy && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {summarizePolicy(policy).map((l) => (
                <li key={l}>{readable(l, names)}</li>
              ))}
            </ul>
          )
        )}
        <div className="mt-3">
          <ActionButton
            disabled={!policy}
            onClick={async () => {
              setLog([]);
              onCreating(true);
              const progress = (m: string) => setLog((l) => [...l, m]);
              setFailed(false);
              try {
                await createWill(
                  owner,
                  {
                    policy: policy!,
                    contacts: list(contacts),
                    schedule: demoClock ? DEMO_SCHEDULE : realSchedule(quietDays),
                    foreignChains: [...(assets.ETH ? ["Eth" as const] : []), ...(assets.BTC ? ["Btc" as const] : [])],
                    depositNear: notesOnly ? "0" : deposit,
                  },
                  progress,
                );
                for (const n of readyNotes(notes)) {
                  progress(`Sealing “${n.label}” in this browser…`);
                  await addSealedNote(owner, n.heir, n.label.trim(), n.text);
                }
                // Test guardians generated here hold their keys in this browser: they accept at once.
                const local = list(guardians).filter((g) => keys.secret(g));
                if (local.length) await acceptAsGuardians(owner, local, progress);
                // Everyone on the new will is in Profile too; the draft is done.
                const known = localProfile(owner).people;
                const add = heirs
                  .filter((h) => h.account.trim() && !known.some((k) => k.account === h.account.trim()))
                  .map((h) => ({ id: newId(), name: h.name.trim(), role: "heir" as const, account: h.account.trim(), ...(h.eth ? { eth: h.eth } : {}), ...(h.btc ? { btc: h.btc } : {}) }));
                await saveProfile(owner, { people: [...known, ...add], draft: null, setupDone: true }).catch(() => {});
                progress("Done. Send each guardian the link on your dashboard.");
                onCreated();
                onCreating(false);
              } catch (e) {
                // Stay here with the log and the error; the will may already exist on-chain.
                setFailed(true);
                throw e;
              }
            }}
          >
            Start my will
          </ActionButton>
          <ActionButton tone="quiet" className="ml-2" onClick={async () => (await saveProfile(owner, { draft: draftForm() }), setDraftSaved(true))}>
            Save as draft
          </ActionButton>
          {draftSaved && <span className="ml-2 text-sm text-accent">Draft saved. Nothing is on-chain until you start.</span>}
          {failed && (
            <ActionButton tone="quiet" className="ml-2" onClick={async () => (onCreating(false), onCreated())}>
              Go to my dashboard anyway
            </ActionButton>
          )}
        </div>
        {log.length > 0 && (
          <ul className="mt-3 font-mono text-xs text-muted">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

