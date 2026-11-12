"use client";
// Progressive onboarding (CLAUDE.md §8): a minimum will in 3 steps (signals, people, vault) with a
// live allocation preview, then a will-strength checklist. Percentages, not amounts; sign-up asks
// only for a display name (jurisdiction optional), both kept in the off-chain policy.
import { useEffect, useRef, useState } from "react";
import { checkPolicy, summarizePolicy, type Policy } from "@agent/policy/policy";
import { STANDARD_PCT } from "@agent/policy/schedule";
import { agent } from "@/lib/agent";
import { DEMO_SCHEDULE, REAL_SCHEDULE } from "@/lib/config";
import { acceptAsGuardians, createWill } from "@/lib/demo";
import { keys } from "@/lib/keys";
import { createPerson } from "@/lib/onboard";
import { newTestReceive, testReceiveFor } from "@/lib/test-wallets";
import { useOverview } from "@/lib/hooks";
import { humanize, nameOf, useAccountLabel, useNames } from "@/lib/names";
import { signRequest } from "@/lib/near";
import { acceptedGuardians, isArmed, type Will } from "@/lib/will";
import { TelegramLink } from "./TelegramLink";
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
function PeopleField({
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
  summary: (stagesPct: number[], demoClock: boolean) => React.ReactNode;
}) {
  const [name, setName] = useState(() => nameOf(owner) ?? "");
  const [jurisdiction, setJurisdiction] = useState("");
  const [evm, setEvm] = useState("");
  const [heirs, setHeirs] = useState<HeirRow[]>([{ name: "", account: "", pct: "100", eth: "", btc: "" }]);
  const [guardians, setGuardians] = useState("");
  const [threshold, setThreshold] = useState("2");
  const [lawyer, setLawyer] = useState("");
  const [contacts, setContacts] = useState("");
  const [assets, setAssets] = useState({ ETH: false, BTC: false });
  const [deposit, setDeposit] = useState("0.5");
  const [demoClock, setDemoClock] = useState(true);
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
  const errors = [
    ...(name.trim() ? [] : ["Add your display name."]),
    ...(guardianList.length < 2 ? ["Choose at least two guardians."] : []),
    ...badAccounts.map((a) => `“${a}” isn't a valid NEAR account name.`),
    ...(check.ok ? [] : check.errors),
  ];
  const policy = check.ok && !errors.length ? (check.policy as Policy) : null;
  const pctTotal = heirs.reduce((s, h) => s + (Number(h.pct) || 0), 0);
  const nearDeposit = Number(deposit) || 0;

  const setHeir = (i: number, patch: Partial<HeirRow>) => setHeirs((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  return (
    <div className="space-y-6">
      <Card title="About you">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name" hint="Shown to heirs and guardians.">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" />
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
              <input className={inputCls} value={h.name} onChange={(e) => setHeir(i, { name: e.target.value })} aria-label="Heir's name" placeholder="Heir's name" />
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
            <input className={inputCls} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
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
              const pct = Number(h.pct) || 0;
              const parts = [`${+(nearDeposit * pct / 100).toFixed(4)} NEAR`];
              if (assets.ETH) parts.push(`${pct}% of the ETH vault`);
              if (assets.BTC) parts.push(`${pct}% of the BTC vault`);
              return (
                <li key={i}>
                  {parts.join(" + ")} → <b>{h.name || `heir ${i + 1}`}</b>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs text-muted">10% → 20% → 30% → 40%, longest wait after the first. Fund ETH and BTC vaults afterwards.</p>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={demoClock} onChange={(e) => setDemoClock(e.target.checked)} />
          Demo clock (minutes instead of months)
        </label>
        <div className="mt-2">{summary(STANDARD_PCT, demoClock)}</div>
      </Card>

      <Card title="Check and approve">
        {errors.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
            {errors.map((e) => (
              <li key={e}>{humanize(e, names)}</li>
            ))}
          </ul>
        ) : (
          policy && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {summarizePolicy(policy).map((l) => (
                // "Anouk (anouk.…testnet)" humanizes to "Anouk (Anouk)": say the name once.
                <li key={l}>{humanize(l, names).replace(/([^\s(]+) \(\1\)/g, "$1")}</li>
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
                    schedule: demoClock ? DEMO_SCHEDULE : REAL_SCHEDULE,
                    foreignChains: [...(assets.ETH ? ["Eth" as const] : []), ...(assets.BTC ? ["Btc" as const] : [])],
                    depositNear: deposit,
                  },
                  progress,
                );
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
              {i.required && <span className="ml-1 text-xs text-muted">(needed to arm)</span>}
              {!i.done && i.hint && <span className="block text-xs text-muted">{i.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!tg?.linked && (
        <div className="mt-3">
          <TelegramLink account={owner} purpose="So the agent can check in there if you go quiet." />
        </div>
      )}
    </Card>
  );
}
