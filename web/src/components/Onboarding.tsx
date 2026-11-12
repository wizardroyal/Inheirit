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
import { useOverview } from "@/lib/hooks";
import { humanize, nameOf, readable, useAccountLabel, useNames } from "@/lib/names";
import { signRequest } from "@/lib/near";
import { acceptedGuardians, isArmed, type Will } from "@/lib/will";
import { TelegramLink } from "./TelegramLink";
import { QuietPeriod, realSchedule } from "./QuietPeriod";
import { type DraftNote, FinalSecrets, readyNotes } from "./FinalSecrets";
import { ActionButton, Card, Field, inputCls, Pill, SimulatedTag } from "./ui";

const ACCOUNT = /^[a-z0-9._-]{2,64}$/;

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

/** A generated person, shown by name; the account id stays out of sight. */
function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
      {label}
      <button type="button" aria-label={`Remove ${label}`} className="px-1 text-muted hover:text-ink" onClick={onRemove}>
        ×
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
      className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg border border-field bg-card text-accent hover:bg-accent-soft disabled:opacity-50"
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
  const add = (id: string) => {
    if (!id || people.includes(id)) return;
    onChange((single ? [id] : [...people, id]).join(", "));
    setDraft("");
  };
  return (
    <div className="space-y-2">
      {people.length > 0 && (
        <div className="flex flex-wrap gap-2">
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
          <GenerateButton owner={owner} what={what} onMade={(p) => add(p.accountId)} />
        </span>
      )}
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
  const [notesOnly, setNotesOnly] = useState(false);
  const [notes, setNotes] = useState<DraftNote[]>([]);
  const [demoClock, setDemoClock] = useState(true);
  const [quietDays, setQuietDays] = useState<number | null>(null);
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
  const nearDeposit = Number(deposit) || 0;

  const setHeir = (i: number, patch: Partial<HeirRow>) => setHeirs((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  return (
    <div className="space-y-6" onChangeCapture={() => setTouched(true)} onClickCapture={(e) => (e.target as HTMLElement).closest("button") && setTouched(true)}>
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

      <Card title="1 · Signs of life" aside={<Pill tone="accent">your NEAR account always counts</Pill>}>
        <p className="text-sm text-muted">
          No check-ins. Every transaction you sign already counts.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Your own Sepolia address (optional)" hint="Not a vault.">
            <input className={inputCls} value={evm} onChange={(e) => setEvm(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <div className="text-sm">
            <p className="font-medium">Heartbeat app</p>
            <p className="text-muted">
              Add <a className="text-accent underline" href="/heartbeat" target="_blank" rel="noreferrer">the heartbeat app</a> to your phone&apos;s home screen. Opening it is a strong sign of life.
            </p>
          </div>
        </div>
      </Card>

      <Card title="2 · The people">
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
                    <input className={`${inputCls} min-w-0 flex-1`} value={h.eth} onChange={(e) => setHeir(i, { eth: e.target.value.trim() })} aria-label="Heir's Sepolia address" placeholder="Receives Sepolia ETH at 0x…" />
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
          <Field label="How many must confirm">
            <input className={`${inputCls} w-20`} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
          <Field label="Lawyer (optional)" group hint="Can speed up the release, never skip the challenge period.">
            <PeopleField owner={owner} what="lawyer" value={lawyer} onChange={setLawyer} label={label} single />
          </Field>
          <Field label="Friends for a welfare check (optional)" group hint="Can only stop it, never start it.">
            <PeopleField owner={owner} what="friend" value={contacts} onChange={setContacts} label={label} />
          </Field>
        </div>
      </Card>

      <Card title="3 · The vault">
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={notesOnly}
            onChange={(e) => {
              setNotesOnly(e.target.checked);
              if (e.target.checked) {
                setAssets({ ETH: false, BTC: false });
                setStable(false);
                if (!notes.length) setNotes([{ heir: heirs.find((h) => h.account)?.account ?? "", label: "", text: "" }]);
              }
            }}
          />
          <span>
            <b>Notes only, no vaults</b>: nothing held for you; only sealed notes, released last.
          </span>
        </label>
        {!notesOnly && (<>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked disabled /> NEAR (held by the contract)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={assets.ETH} onChange={(e) => setAssets({ ...assets, ETH: e.target.checked })} /> Sepolia ETH vault
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={assets.BTC} onChange={(e) => setAssets({ ...assets, BTC: e.target.checked })} /> BTC testnet4 vault
          </label>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={stable} onChange={(e) => setStable(e.target.checked)} />
          <span>
            <b>Pay heirs in dollars</b>: each slice becomes USDC on the heir&apos;s chain via NEAR Intents.{" "}
            <SimulatedTag /> on testnet.
          </span>
        </label>
        <div className="mt-3 max-w-xs">
          <Field label="NEAR to put in the vault now">
            <input className={inputCls} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 rounded-lg bg-accent-soft p-3 text-sm">
          <p className="font-medium">Who gets what</p>
          <ul className="mt-1 space-y-0.5">
            {heirs.map((h, i) => {
              const pct = Math.max(0, Math.min(100, Number(h.pct) || 0));
              const parts = [`${+(Math.max(0, nearDeposit) * pct / 100).toFixed(4)} NEAR`];
              if (assets.ETH) parts.push(`${pct}% of the ETH vault`);
              if (assets.BTC) parts.push(`${pct}% of the BTC vault`);
              return (
                <li key={i} className="break-words">
                  {parts.join(" + ")} → <b>{h.name || `heir ${i + 1}`}</b>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs text-muted">10% → 20% → 30% → 40%, longest wait after the first. Fund ETH and BTC vaults afterwards.</p>
        </div>
        </>)}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={demoClock} onChange={(e) => setDemoClock(e.target.checked)} />
          Demo clock (minutes instead of months)
        </label>
        {!demoClock && (
          <div className="mt-3">
            <QuietPeriod owner={owner} evm={evm} value={quietDays} onChange={setQuietDays} />
          </div>
        )}
        <div className="mt-2">{summary(STANDARD_PCT, demoClock, quietDays)}</div>
      </Card>

      <Card title={notesOnly ? "4 · Final secrets" : "4 · Final secrets (optional)"}>
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
                if (evm) {
                  progress("Adding your Sepolia address as a sign of life…");
                  await agent.registerOwner(await signRequest(owner, "register_owner", { evm_address: evm }));
                }
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
            Approve and create my will
          </ActionButton>
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

/** Will strength (CLAUDE.md §8): what makes the will armed, and what makes it more robust. */
export function StrengthChecklist({ will }: { will: Will }) {
  const owner = will.owner;
  const { data: overview } = useOverview(owner);
  const signals = overview?.signals;
  const status = overview?.status;
  const tg = overview?.telegram;
  // Newer agents return flags (evm/github/email); older ones returned the values themselves.
  const watching = (status?.watching ?? {}) as { evm?: boolean; github?: boolean | string; evmAddress?: string };
  const accepted = acceptedGuardians(will).length;
  const items: { label: string; done: boolean; required?: boolean; hint?: string }[] = [
    { label: `Enough guardians accepted (${accepted} accepted, ${will.guardian_threshold} needed)`, done: isArmed(will), required: true, hint: "Send the link under People" },
    { label: "At least one heir", done: will.heirs.length > 0, required: true },
    { label: "A strong sign-of-life source (your NEAR account)", done: true, required: true },
    { label: "Heartbeat app opened once", done: !!signals?.heartbeat, hint: "Add it to your phone's home screen" },
    { label: "Another source (Sepolia address or GitHub)", done: !!(watching.evm || watching.evmAddress || watching.github) },
    { label: "Telegram linked for checks", done: !!tg?.linked },
    { label: "Friends for a welfare check", done: will.contacts.length > 0 },
    { label: "A lawyer", done: !!will.lawyer },
    { label: "A sealed note for an heir (optional)", done: will.sealed_notes.length > 0, hint: "Add one under Sealed notes" },
    { label: "Heirs hidden in the app until release (readable on-chain)", done: will.heirs_hidden },
    { label: "NEAR vault funded", done: BigInt(will.near_balance) > 0n },
  ];
  const optional = items.filter((i) => !i.required);
  const score = Math.round((optional.filter((i) => i.done).length / optional.length) * 100);
  const armed = isArmed(will);
  return (
    <Card title="Will strength" aside={<Pill tone={armed ? "accent" : "warn"}>{armed ? `armed · ${score}%` : "not armed"}</Pill>}>
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2">
            <span className="sr-only">{i.done ? "Done: " : "To do: "}</span>
            <span aria-hidden className={i.done ? "text-accent" : i.required ? "text-danger" : "text-muted"}>
              {i.done ? "✓" : "○"}
            </span>
            <span>
              {i.label}
              {i.required && <span className="text-xs text-muted"> · needed to arm</span>}
              {!i.done && i.hint && <span className="block text-xs text-muted">{i.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!tg?.linked && (
        <div className="mt-3">
          <TelegramLink account={owner} purpose="Checks reach you there first." />
        </div>
      )}
    </Card>
  );
}
