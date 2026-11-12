"use client";
// Pieces of the owner's account area (creation flow, money, signals, people, notes, alerts), shared by
// the /account screens.
import { humanize, readable, useAccountLabel, useNames } from "@/lib/names";
import { summarizePolicy, type Policy } from "@agent/policy/policy";

import { useEffect, useState } from "react";
import { AiBadge } from "@/components/Attestation";

import { ActionButton, Card, ErrorNote, Field, inputCls, Pill } from "@/components/ui";
import { MyWillSetup, PeopleField } from "@/components/Onboarding";
import { QuietPeriod, realSchedule } from "@/components/QuietPeriod";
import { type DraftNote, FinalSecrets, readyNotes } from "@/components/FinalSecrets";
import { DraftGaps, hasGaps } from "@/components/DraftGaps";

import { agent, type DraftResult } from "@/lib/agent";
import { DEMO_SCHEDULE, REAL_SCHEDULE } from "@/lib/config";
import { stagesFor, summarize } from "@agent/policy/schedule";
import { acceptAsGuardians, addSealedNote, createWill, generateWillAndCast } from "@/lib/demo";
import { createInvite, type InviteRole, nameClaimedInvites } from "@/lib/invites";
import { keys } from "@/lib/keys";
import { useKeys, useNow, usePoll } from "@/lib/hooks";
import { topUpAccount } from "@/lib/onboard";
import { disconnectWallet, walletAccountId } from "@/lib/wallet";
import { balanceOf, call, formatNear, nearToYocto, signRequest } from "@/lib/near";
import { ago, duration, stateName, type Will } from "@/lib/will";

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
export function AccountActions({ owner, onSignIn, onSignedOut }: { owner: string; onSignIn: () => void; onSignedOut: () => void }) {
  useKeys(); // re-render when the wallet or the key store changes
  const wallet = !!owner && walletAccountId() === owner;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {wallet && (
        <button type="button" className="text-accent underline" onClick={() => disconnectWallet().then(onSignedOut)}>
          Disconnect wallet
        </button>
      )}
      <button type="button" className="text-muted underline hover:text-ink" onClick={onSignIn}>
        Use another account
      </button>
    </div>
  );
}

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

/** Three tabs: My will (default), Will in plain English (drafted by NEAR AI), Generate sample will. */
export function CreateWill(props: { owner: string; onCreating: (b: boolean) => void; onCreated: () => void }) {
  const [mode, setMode] = useSessionState<"generate" | "quick" | "english">(`inheirit:tab:${props.owner}`, "quick");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="How to write your will">
        {(
          [
            ["quick", "My will"],
            ["english", "Will in plain English"],
            ["generate", "Generate sample will"],
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
      {mode === "generate" ? (
        <GenerateWill {...props} />
      ) : mode === "quick" ? (
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
            {c === "Eth" ? "Sepolia ETH vault" : "BTC testnet4 vault"}
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
        Sepolia ETH and testnet BTC come from a small pool while it lasts; otherwise only NEAR moves.
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
  const [demoClock, setDemoClock] = useState(true);
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={demoClock} onChange={(e) => setDemoClock(e.target.checked)} />
              Demo clock: quiet after {duration(DEMO_SCHEDULE.timings.quiet_after)} instead of days
            </label>
            {!demoClock && <QuietPeriod owner={owner} value={quietDays} onChange={setQuietDays} />}
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

export function NearVaultActions({ owner, refresh }: { owner: string; refresh: () => void }) {
  const [amount, setAmount] = useState("0.1");
  return (
    <div className="mt-3 flex flex-wrap items-start gap-2">
      <input className={`${inputCls} w-24`} aria-label="Amount in NEAR" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <ActionButton tone="quiet" onClick={() => call(owner, "deposit_near", {}, nearToYocto(amount)).then(refresh)}>
        Deposit
      </ActionButton>
      <ActionButton
        tone="quiet"
        onClick={() => call(owner, "request_withdrawal", { chain: "Near", to: owner, amount: nearToYocto(amount).toString() }, 0n, 100n).then(refresh)}
      >
        Withdraw to me
      </ActionButton>
    </div>
  );
}

/** Decimal string → smallest units (wei or sats), without floating point. */
export function toUnits(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.trim().split(".");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(frac) || frac.length > decimals) throw new Error(`"${value}" is not an amount`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

// The owner can always take coins back out while alive (principle 6): the contract queues the request
// and the agent sends it from the vault, signed for this withdrawal only.
export function ForeignWithdraw({ owner, will, refresh }: { owner: string; will: Will; refresh: () => void }) {
  const [chain, setChain] = useState(will.foreign_chains[0]);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const unit = chain === "Eth" ? "ETH" : "BTC";
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted hover:text-ink">Withdraw from the Sepolia or Bitcoin vault</summary>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <select className={`${inputCls} w-28`} value={chain} onChange={(e) => setChain(e.target.value as typeof chain)}>
          {will.foreign_chains.map((c) => (
            <option key={c} value={c}>
              {c === "Eth" ? "Sepolia ETH" : "Bitcoin testnet"}
            </option>
          ))}
        </select>
        <input className={`${inputCls} w-28`} aria-label={`Amount in ${unit}`} placeholder={`amount (${unit})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className={`${inputCls} min-w-0 flex-1`} placeholder={chain === "Eth" ? "0x… your address" : "tb1… your address"} value={to} onChange={(e) => setTo(e.target.value.trim())} />
        <ActionButton
          tone="quiet"
          onClick={() => call(owner, "request_withdrawal", { chain, to, amount: toUnits(amount, chain === "Eth" ? 18 : 8).toString() }, 0n, 100n).then(refresh)}
        >
          Withdraw
        </ActionButton>
      </div>
    </details>
  );
}

/** Extra sources added from this browser (the agent never reveals them, so only this device can list them). */
const ADDED = "inheirit:added-sources";
type Added = { near: string[]; evm: string[] };
function addedFor(owner: string): Added {
  try {
    return (JSON.parse(localStorage.getItem(ADDED) ?? "{}") as Record<string, Added>)[owner] ?? { near: [], evm: [] };
  } catch {
    return { near: [], evm: [] };
  }
}
function saveAdded(owner: string, a: Added) {
  try {
    const all = JSON.parse(localStorage.getItem(ADDED) ?? "{}") as Record<string, Added>;
    all[owner] = a;
    localStorage.setItem(ADDED, JSON.stringify(all));
  } catch {
    // storage blocked: removal then works only by re-entering the lists
  }
}

export function WatchSettings({ owner }: { owner: string }) {
  const [evm, setEvm] = useState("");
  const [nearMore, setNearMore] = useState("");
  const [evmMore, setEvmMore] = useState("");
  const [github, setGithub] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [added, setAdded] = useState<Added>(() => addedFor(owner));
  const items = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  // A list replaces what the agent has, so only a list this device is changing is sent; leaving it out
  // keeps sources added from another device.
  const push = async (next: Added, kinds: ("near" | "evm")[], extra: Record<string, unknown> = {}) => {
    const data = { ...(kinds.includes("near") ? { near_accounts: next.near } : {}), ...(kinds.includes("evm") ? { evm_addresses: next.evm } : {}), ...extra };
    await agent.registerOwner(await signRequest(owner, "register_owner", data));
    saveAdded(owner, next);
    setAdded(next);
  };
  const remove = (kind: "near" | "evm", v: string) => push({ ...added, [kind]: added[kind].filter((x) => x !== v) }, [kind]).then(() => setSaved("Removed."));
  return (
    <div className="mt-4 space-y-4">
      {added.near.length + added.evm.length > 0 ? (
        <div>
          <p className="font-medium">Added from this device</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {added.near.map((v) => (
              <li key={v} className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1">
                {v}
                <button type="button" aria-label={`Remove ${v}`} className="px-1 text-muted hover:text-ink" onClick={() => remove("near", v)}>
                  ×
                </button>
              </li>
            ))}
            {added.evm.map((v) => (
              <li key={v} className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1">
                {v.slice(0, 6)}…{v.slice(-4)}
                <button type="button" aria-label={`Remove ${v}`} className="px-1 text-muted hover:text-ink" onClick={() => remove("evm", v)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">Added sources are private; remove them from the device you added them on.</p>
      )}
      <details>
        <summary className="cursor-pointer text-muted hover:text-ink">Connect more signs of life</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="More NEAR accounts you use" hint="Up to 5. Testnet, or mainnet (.near), read-only.">
            <input className={inputCls} value={nearMore} onChange={(e) => setNearMore(e.target.value)} placeholder="you.near, work.testnet" />
          </Field>
          <Field label="Your Sepolia addresses" hint="Up to 5. Not the vault.">
            <input className={inputCls} value={evmMore} onChange={(e) => setEvmMore(e.target.value)} placeholder="0x…, 0x…" />
          </Field>
          <Field label="Main Sepolia address" hint="Not the vault.">
            <input className={inputCls} value={evm} onChange={(e) => setEvm(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <Field label="GitHub username" hint="Public activity times only.">
            <input className={inputCls} value={github} onChange={(e) => setGithub(e.target.value.trim())} />
          </Field>
        </div>
        <div className="mt-2">
          <ActionButton
            tone="quiet"
            onClick={async () => {
              const next = {
                near: [...new Set([...added.near, ...items(nearMore).map((x) => x.toLowerCase())])].slice(0, 5),
                evm: [...new Set([...added.evm, ...items(evmMore)])].slice(0, 5),
              };
              const kinds = [...(items(nearMore).length ? (["near"] as const) : []), ...(items(evmMore).length ? (["evm"] as const) : [])];
              await push(next, kinds, { ...(evm ? { evm_address: evm } : {}), ...(github ? { github } : {}) });
              setNearMore("");
              setEvmMore("");
              setSaved("Saved. The agent checks every 15 seconds.");
            }}
          >
            Save
          </ActionButton>
          {saved && <span className="ml-2 text-xs text-accent">{saved}</span>}
        </div>
      </details>
    </div>
  );
}

export function InviteByLink({ owner, hasLawyer, will }: { owner: string; hasLawyer: boolean; will: Will }) {
  // Give claimed invitees the name typed for them (names are per browser).
  const people = [
    ...will.guardians.map((g) => ({ role: "guardian" as const, account: g.account_id })),
    ...will.contacts.map((c) => ({ role: "friend" as const, account: c })),
    ...(will.lawyer ? [{ role: "lawyer" as const, account: will.lawyer }] : []),
  ];
  const key = people.map((p) => p.account).join(",");
  useEffect(() => {
    void nameClaimedInvites(owner, people);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, key]);
  const [role, setRole] = useState<InviteRole>("guardian");
  const [name, setName] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted hover:text-ink">Invite someone by link (no NEAR account needed)</summary>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="As">
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
            <option value="guardian">guardian</option>
            <option value="friend">friend</option>
            {!hasLawyer && <option value="lawyer">lawyer</option>}
          </select>
        </Field>
        <Field label="Their name">
          <input className={`${inputCls} min-w-0`} maxLength={64} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ngozi" />
        </Field>
        <ActionButton tone="quiet" onClick={async () => (setCopied(false), setLink(await createInvite(owner, role, name)))}>
          Make link
        </ActionButton>
      </div>
      {link && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-line bg-card px-3 py-1 hover:bg-accent-soft"
            onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <span className="text-xs text-muted">One use, valid 7 days.</span>
        </div>
      )}
    </details>
  );
}

export function EmailAlerts({ will }: { will: Will }) {
  const label = useAccountLabel();
  const owner = will.owner;
  const people = [
    ...will.guardians.map((g) => ({ account: g.account_id, role: "guardian" })),
    ...will.contacts.map((c) => ({ account: c, role: "friend" })),
    ...(will.lawyer ? [{ account: will.lawyer, role: "lawyer" }] : []),
  ];
  const [mine, setMine] = useState("");
  const [theirs, setTheirs] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <Card title="Email alerts">
      <p className="text-sm text-muted">Checks, welfare questions, vote requests and the challenge alarm. Addresses stay in the enclave.</p>
      <div className="mt-3 space-y-2">
        <Field label="Your email">
          <input className={inputCls} type="email" value={mine} onChange={(e) => setMine(e.target.value.trim())} placeholder="you@example.com" />
        </Field>
        {people.map((p) => (
          <Field key={p.account} label={`${label(p.account)} (${p.role})`}>
            <input
              className={inputCls}
              type="email"
              value={theirs[p.account] ?? ""}
              onChange={(e) => setTheirs((t) => ({ ...t, [p.account]: e.target.value.trim() }))}
              placeholder="optional"
            />
          </Field>
        ))}
      </div>
      <div className="mt-3">
        <ActionButton
          tone="quiet"
          onClick={async () => {
            const data: Record<string, unknown> = {};
            if (mine) data.email = mine;
            const filled = Object.fromEntries(Object.entries(theirs).filter(([, v]) => v));
            if (Object.keys(filled).length) data.people_emails = filled;
            await agent.registerOwner(await signRequest(owner, "register_owner", data));
            setSaved("Saved.");
          }}
        >
          Save
        </ActionButton>
        {saved && <span className="ml-2 text-xs text-accent">{saved}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">Empty keeps what&apos;s saved. Each address gets at most 12 emails a day.</p>
    </Card>
  );
}

export function SealedNotes({ will, refresh }: { will: Will; refresh: () => void }) {
  const who = useAccountLabel();
  const [heir, setHeir] = useState(will.heirs[0]?.account_id ?? "");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const active = stateName(will.state) === "Active";
  return (
    <Card title="Sealed notes" aside={<Pill>{will.sealed_notes.length} of 10</Pill>}>
      <p className="text-sm text-muted">
        Encrypted here to the enclave&apos;s key. Released last, per heir, after distribution and one more wait.
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {will.sealed_notes.map((n) => {
          const released = will.released_notes.some((r) => r.note_id === n.id);
          return (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {n.label} <span className="text-muted">for {who(n.heir)}</span> {released && <Pill tone="accent">released</Pill>}
              </span>
              {active && (
                <ActionButton tone="quiet" onClick={() => call(will.owner, "remove_sealed_note", { note_id: n.id }).then(refresh)}>
                  Remove
                </ActionButton>
              )}
            </li>
          );
        })}
        {will.sealed_notes.length === 0 && <li className="text-muted">No notes yet (optional).</li>}
      </ul>
      {active && (
        <div className="mt-4 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={inputCls} aria-label="Heir the note is for" value={heir} onChange={(e) => setHeir(e.target.value)}>
              {will.heirs.map((h) => (
                <option key={h.account_id} value={h.account_id}>
                  for {h.name}
                </option>
              ))}
            </select>
            <input className={inputCls} aria-label="Note title" placeholder="Title (anyone can see it on-chain)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={64} />
          </div>
          <textarea className={`${inputCls} h-24 w-full`} aria-label="Note text" placeholder="What should they know? (Encrypted here.)" maxLength={1200} value={text} onChange={(e) => setText(e.target.value)} />
          <ActionButton
            disabled={!label || !text}
            onClick={async () => {
              await addSealedNote(will.owner, heir, label, text);
              setText("");
              setLabel("");
              refresh();
            }}
          >
            Seal and save
          </ActionButton>
          <p className="text-xs text-muted">
            Tip: instructions beat raw keys. Split a seed phrase from its passphrase.
          </p>
        </div>
      )}
      {will.released_notes.length > 0 && <p className="mt-2 text-xs text-muted">Last release {ago(will.released_notes[will.released_notes.length - 1].at)}.</p>}
    </Card>
  );
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
