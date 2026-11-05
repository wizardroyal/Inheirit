"use client";
// Progressive onboarding (CLAUDE.md §8): a minimum will in 3 steps (signals, people, vault) with a
// live allocation preview, then a will-strength checklist. Percentages, not amounts; sign-up asks
// only for a display name (jurisdiction optional), both kept in the off-chain policy.
import { useState } from "react";
import { checkPolicy, summarizePolicy, type Policy } from "@agent/policy/policy";
import { STANDARD_PCT } from "@agent/policy/schedule";
import { agent } from "@/lib/agent";
import { DEMO_SCHEDULE, REAL_SCHEDULE } from "@/lib/config";
import { createWill } from "@/lib/demo";
import { usePoll } from "@/lib/hooks";
import { signRequest } from "@/lib/near";
import { acceptedGuardians, isArmed, type Will } from "@/lib/will";
import { TelegramLink } from "./TelegramLink";
import { ActionButton, Card, ErrorNote, Field, inputCls, Pill } from "./ui";

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

export function QuickSetup({
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
  const [name, setName] = useState("");
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
  const [log, setLog] = useState<string[]>([]);

  const guardianList = list(guardians);
  const badAccounts = [...heirs.map((h) => h.account), ...guardianList, ...(lawyer ? [lawyer] : [])].filter((a) => a && !ACCOUNT.test(a));
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
  });
  const errors = [
    ...(name.trim() ? [] : ["Your display name is required"]),
    ...(guardianList.length < 2 ? ["Choose at least two guardians"] : []),
    ...badAccounts.map((a) => `${a} is not a valid NEAR account id`),
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
          <Field label="Display name" hint="How heirs and guardians will see you. Required.">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Alice" />
          </Field>
          <Field label="Jurisdiction (optional)" hint="For a future lawyer letter. Nothing else is asked: no date of birth, nationality or photo.">
            <input className={inputCls} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="Nigeria" />
          </Field>
        </div>
      </Card>

      <Card title="1 · Signs of life" aside={<Pill tone="accent">your NEAR account is always watched</Pill>}>
        <p className="text-sm text-muted">
          You never need to check in. The agent watches normal activity and only reaches out if you go quiet for longer than usual. A strong source
          is already on: every transaction you sign with <b>{owner}</b>.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="A personal Sepolia address (optional)" hint="Not a vault. Your outgoing transactions count as signs of life.">
            <input className={inputCls} value={evm} onChange={(e) => setEvm(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <div className="text-sm">
            <p className="font-medium">Heartbeat app</p>
            <p className="text-muted">
              Open <a className="text-accent underline" href="/heartbeat">/heartbeat</a> on your phone and add it to your home screen. Opening it is a
              strong sign of life.
            </p>
          </div>
        </div>
      </Card>

      <Card title="2 · The people">
        <p className="mb-3 text-sm text-muted">Heirs receive in stages. Guardians must accept the invitation; until enough have, the will can never start.</p>
        <div className="space-y-3">
          {heirs.map((h, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1.4fr_5rem_auto]">
              <input className={inputCls} value={h.name} onChange={(e) => setHeir(i, { name: e.target.value })} placeholder="Heir name (Ada)" />
              <input className={inputCls} value={h.account} onChange={(e) => setHeir(i, { account: e.target.value.trim() })} placeholder="NEAR account (ada.testnet)" />
              <input className={inputCls} value={h.pct} onChange={(e) => setHeir(i, { pct: e.target.value })} aria-label="Share in percent" />
              {heirs.length > 1 ? (
                <ActionButton tone="quiet" onClick={async () => setHeirs((hs) => hs.filter((_, j) => j !== i))}>
                  Remove
                </ActionButton>
              ) : (
                <span />
              )}
              {assets.ETH && (
                <input className={`${inputCls} sm:col-span-2`} value={h.eth} onChange={(e) => setHeir(i, { eth: e.target.value })} placeholder="Receives ETH at 0x…" />
              )}
              {assets.BTC && (
                <input className={`${inputCls} sm:col-span-2`} value={h.btc} onChange={(e) => setHeir(i, { btc: e.target.value })} placeholder="Receives BTC at tb1…" />
              )}
            </div>
          ))}
          <div className="flex items-center gap-3 text-sm">
            <ActionButton tone="quiet" onClick={async () => setHeirs((hs) => [...hs, { name: "", account: "", pct: "0", eth: "", btc: "" }])}>
              Add an heir
            </ActionButton>
            <span className={pctTotal === 100 ? "text-muted" : "text-danger"}>shares total {pctTotal}%</span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Guardians" hint="At least two NEAR accounts, comma-separated. Not heirs.">
            <input className={inputCls} value={guardians} onChange={(e) => setGuardians(e.target.value)} placeholder="g1.testnet, g2.testnet, g3.testnet" />
          </Field>
          <Field label="How many must confirm">
            <input className={inputCls} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
          <Field label="Lawyer (optional)" hint="Can speed up release with a death certificate; never skips the waiting periods.">
            <input className={inputCls} value={lawyer} onChange={(e) => setLawyer(e.target.value.trim())} placeholder="lawyer.testnet" />
          </Field>
          <Field label="Friends for a welfare check (optional)" hint="NEAR accounts, comma-separated. They can only delay, never start.">
            <input className={inputCls} value={contacts} onChange={(e) => setContacts(e.target.value)} placeholder="friend.testnet" />
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
          <p className="mt-1 text-xs text-muted">Released 10% → 20% → 30% → 40%, the longest wait after the first slice. Fund the ETH/BTC vaults after creating the will.</p>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={demoClock} onChange={(e) => setDemoClock(e.target.checked)} />
          Demo clock (minutes instead of months)
        </label>
        <div className="mt-2">{summary(STANDARD_PCT, demoClock)}</div>
      </Card>

      <Card title="Check and create">
        {errors.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          policy && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {summarizePolicy(policy).map((l) => (
                <li key={l}>{l}</li>
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
                if (evm) {
                  progress("Adding your Sepolia address as a sign-of-life source…");
                  await agent.registerOwner(await signRequest(owner, "register_owner", { evm_address: evm }));
                }
                progress("Done. Send each guardian their invitation link: /guardian/" + owner);
                onCreated();
              } finally {
                onCreating(false);
              }
            }}
          >
            Approve and create my will
          </ActionButton>
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
  const { data: signals } = usePoll(() => agent.signals(owner), 10_000, [owner]);
  const { data: status } = usePoll(() => agent.status(owner), 10_000, [owner]);
  const { data: tg } = usePoll(() => agent.telegramStatus(owner), 10_000, [owner]);
  const watching = (status?.watching ?? {}) as { evmAddress?: string; github?: string; email?: string };
  const accepted = acceptedGuardians(will).length;
  const items: { label: string; done: boolean; required?: boolean; hint?: string }[] = [
    { label: `Guardians accepted (${accepted} of ${will.guardian_threshold} needed)`, done: isArmed(will), required: true, hint: `Send each guardian /guardian/${owner}` },
    { label: "At least one heir", done: will.heirs.length > 0, required: true },
    { label: "A strong sign-of-life source (your NEAR account)", done: true, required: true },
    { label: "Heartbeat app used", done: !!signals?.heartbeat, hint: "Open /heartbeat on your phone once" },
    { label: "Another source (Sepolia address or GitHub)", done: !!(watching.evmAddress || watching.github) },
    { label: "Telegram linked for checks", done: !!tg?.linked },
    { label: "Friends for a welfare check", done: will.contacts.length > 0 },
    { label: "A lawyer (can speed up release with a death certificate)", done: !!will.lawyer },
    { label: "Final secrets sealed (optional)", done: will.sealed_notes.length > 0, hint: "Add a sealed note below" },
    { label: "Heirs hidden until execution", done: will.heirs_hidden },
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
          <TelegramLink account={owner} purpose="Link Telegram so the agent can check in there first if you go quiet." />
        </div>
      )}
      {!armed && <ErrorNote>Not armed: until {will.guardian_threshold} guardians accept, nothing can ever start.</ErrorNote>}
    </Card>
  );
}
