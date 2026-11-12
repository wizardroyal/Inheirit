"use client";
import { accountLabel, ensureName, humanize, readable, rememberOwner, useAccountLabel, useNames } from "@/lib/names";
import { summarizePolicy, type Policy } from "@agent/policy/policy";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AiBadge } from "@/components/Attestation";
import { Ladder } from "@/components/Ladder";
import { ActionButton, Card, CopyLink, Details, ErrorNote, Field, inputCls, NoWill, Pill, short } from "@/components/ui";
import { MyWillSetup, PeopleField, StrengthChecklist } from "@/components/Onboarding";
import { QuietPeriod, realSchedule } from "@/components/QuietPeriod";
import { type DraftNote, FinalSecrets, readyNotes } from "@/components/FinalSecrets";
import { DraftGaps, hasGaps } from "@/components/DraftGaps";
import { FundAnywhere, PayoutsPanel } from "@/components/Payouts";
import { SignIn } from "@/components/SignIn";
import { SignsOfLife } from "@/components/SignsOfLife";
import { Speedrun } from "@/components/Speedrun";
import { Vaults } from "@/components/Vaults";
import { NotificationLog, Releases, SignalList, WatchStatus } from "@/components/WillParts";
import { agent, type DraftResult } from "@/lib/agent";
import { DEMO_SCHEDULE, REAL_SCHEDULE } from "@/lib/config";
import { stagesFor, summarize } from "@agent/policy/schedule";
import { acceptAsGuardians, addSealedNote, createWill, generateWillAndCast } from "@/lib/demo";
import { keys } from "@/lib/keys";
import { useKeys, useMyAccounts, useNow, usePoll, useWill } from "@/lib/hooks";
import { topUpAccount } from "@/lib/onboard";
import { disconnectWallet, walletAccountId } from "@/lib/wallet";
import { balanceOf, call, canSign, formatNear, nearToYocto, signRequest } from "@/lib/near";
import { ago, duration, isArmed, schedule, stateName, type Will } from "@/lib/will";

export default function OwnerPage() {
  return (
    <Suspense>
      <Owner />
    </Suspense>
  );
}

const CURRENT = "inheirit:current-owner";

function Owner() {
  const params = useSearchParams();
  const [owner, setOwnerState] = useState(params.get("as") ?? "");
  // Coming back to this page reopens the account used last, instead of the sign-in screen.
  useEffect(() => {
    if (!params.get("as")) {
      try {
        const last = window.localStorage.getItem(CURRENT) ?? "";
        if (last) setOwnerState(last);
      } catch {
        // storage blocked: sign in again
      }
    }
  }, [params]);
  const setOwner = (id: string) => {
    setOwnerState(id);
    try {
      if (id) window.localStorage.setItem(CURRENT, id);
      else window.localStorage.removeItem(CURRENT);
    } catch {
      // storage blocked
    }
  };
  const [signingIn, setSigningIn] = useState(false);
  const { data: will, loaded, refresh } = useWill(owner || null);
  // Keep the writing view until every creation step has finished, even after the will shows up on-chain
  const [creating, setCreating] = useState(false);
  const showSignIn = signingIn || !owner;
  // Accounts signed in before usernames existed get one now, so no ".testnet" id is ever shown.
  useEffect(() => {
    // Only accounts this browser can sign for: viewing someone else's will (?as=) names and remembers nothing.
    if (owner && canSign(owner)) {
      ensureName(owner);
      rememberOwner(owner);
    }
  }, [owner]);
  const names = useNames();
  const mine = useMyAccounts();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <h1 className="font-serif text-4xl sm:text-5xl">Your will</h1>
        {owner && !signingIn && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">{canSign(owner) ? "Signed in as" : "Viewing"}</span>
            <span className="font-medium">{accountLabel(owner, names)}</span>
            <AccountActions owner={owner} onSignIn={() => (setSigningIn(true), setOwner(""))} onSignedOut={() => setOwner("")} />
          </div>
        )}
        {showSignIn && mine.length > 0 && (
          <div className="order-last flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Welcome back:</span>
            {mine.map((a) => (
              <button
                key={a}
                type="button"
                className="rounded-full border border-line bg-card px-3 py-1 hover:bg-accent-soft"
                onClick={() => {
                  setOwner(a);
                  setSigningIn(false);
                }}
              >
                {accountLabel(a, names)}
              </button>
            ))}
          </div>
        )}
        {showSignIn && (
          <SignIn
            onSignedIn={(id) => {
              setOwner(id);
              setSigningIn(false);
            }}
          />
        )}
      </div>
      {owner && loaded && !will && !creating && canSign(owner) && <LowBalance owner={owner} />}
      {owner && loaded && (!will || creating) && canSign(owner) && <CreateWill owner={owner} onCreating={setCreating} onCreated={refresh} />}
      {owner && loaded && !will && !canSign(owner) && <NoWill owner={owner} />}
      {owner && will && !creating && <Dashboard will={will} refresh={refresh} />}
    </div>
  );
}

/** A wallet account with almost no testnet NEAR can't create a will; offer a free top-up. */
function LowBalance({ owner }: { owner: string }) {
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
function AccountActions({ owner, onSignIn, onSignedOut }: { owner: string; onSignIn: () => void; onSignedOut: () => void }) {
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
function useSessionState<T>(key: string, initial: T): [T, (v: T) => void] {
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
function CreateWill(props: { owner: string; onCreating: (b: boolean) => void; onCreated: () => void }) {
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
function GenerateWill({ owner, onCreating, onCreated }: { owner: string; onCreating: (b: boolean) => void; onCreated: () => void }) {
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

function WriteWill({ owner, onCreating, onCreated }: { owner: string; onCreating: (b: boolean) => void; onCreated: () => void }) {
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

function Dashboard({ will, refresh }: { will: Will; refresh: () => void }) {
  const owner = will.owner;
  const label = useAccountLabel();
  const s = stateName(will.state);
  const active = s === "Active";
  return (
    <div className="space-y-6">
      <SignsOfLife owner={owner} will={will} />
      <Speedrun will={will} refresh={refresh} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="min-w-0 space-y-6">
        <Card title="Where your will stands">
          <WatchStatus owner={owner} will={will} canSign />
          <Ladder will={will} compact />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionButton disabled={s === "Completed"} onClick={() => call(owner, "i_am_alive").then(refresh)}>
              I&apos;m alive
            </ActionButton>
            <span className="text-xs text-muted">Cancels any stage, even mid-release.</span>
          </div>
        </Card>
        <Card title="Signs of life: connections">
          <SignalList owner={owner} will={will} />
          <WatchSettings owner={owner} />
        </Card>
        <Card title="People">
          <dl className="space-y-1 text-sm">
            {will.heirs.map((h) => (
              <div key={h.account_id} className="flex flex-wrap justify-between gap-2">
                <dt>
                  Heir: {h.name}
                </dt>
                <dd className="text-muted">{h.near_share_bps / 100}% of NEAR</dd>
              </div>
            ))}
            <div className="flex flex-wrap justify-between gap-2">
              <dt>Guardians</dt>
              <dd className="text-muted">
                {will.guardian_threshold} of {will.guardians.length}:{" "}
                {will.guardians.map((g) => `${label(g.account_id)}${g.accepted ? "" : " (invited)"}`).join(", ")}
              </dd>
            </div>
            {will.contacts.length > 0 && (
              <div className="flex flex-wrap justify-between gap-2">
                <dt>Friends (welfare check)</dt>
                <dd className="text-muted">{will.contacts.map(label).join(", ")}</dd>
              </div>
            )}
          </dl>
          {!isArmed(will) && (
            <div className="mt-2 space-y-1 text-sm text-warn">
              <p>
                Not armed: {will.guardian_threshold} guardian{will.guardian_threshold > 1 ? "s" : ""} must accept. Send them this link:
              </p>
              <CopyLink path={`/guardian/${owner}`} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            Release: {schedule(will).map((st) => `${st.pct}% (then wait ${duration(st.wait_after)})`).join(" → ")}; sealed notes after a further{" "}
            {duration(will.timings.secrets_buffer)}.
          </p>
          <div className="mt-2">
            <Details summary="Technical details">
              <div>policy hash {will.policy_hash}</div>
            </Details>
          </div>
        </Card>
        <Card title="Messages sent">
          <NotificationLog owner={owner} />
        </Card>
      </div>
      <div className="min-w-0 space-y-6">
        <StrengthChecklist will={will} />
        <EmailAlerts will={will} />
        <Vaults owner={owner} will={will}>
          {active ? (
            <NearVaultActions owner={owner} refresh={refresh} />
          ) : (
            <p className="mt-2 text-xs text-muted">Deposits and withdrawals only at All good.</p>
          )}
          {active && will.foreign_chains.length > 0 && <ForeignWithdraw owner={owner} will={will} refresh={refresh} />}
          {will.pending_withdrawals.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {will.pending_withdrawals.map((w) => (
                <li key={w.id}>
                  Withdrawal to {w.chain === "Near" ? label(w.to) : short(w.to, 8)} on {w.chain === "Eth" ? "Sepolia" : w.chain === "Btc" ? "Bitcoin testnet" : "NEAR"}: the agent is sending it
                </li>
              ))}
            </ul>
          )}
        </Vaults>
        <SealedNotes will={will} refresh={refresh} />
        <Card title="Released so far">
          <Releases will={will} />
        </Card>
        <Card title="Payouts to heirs (NEAR Intents)">
          <PayoutsPanel owner={owner} />
        </Card>
        {active && (
          <Card title="Fund from another chain (NEAR Intents)">
            <FundAnywhere owner={owner} vaults={["Near", ...will.foreign_chains]} />
          </Card>
        )}
      </div>
      </div>
    </div>
  );
}

function NearVaultActions({ owner, refresh }: { owner: string; refresh: () => void }) {
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
function toUnits(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.trim().split(".");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(frac) || frac.length > decimals) throw new Error(`"${value}" is not an amount`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

// The owner can always take coins back out while alive (principle 6): the contract queues the request
// and the agent sends it from the vault, signed for this withdrawal only.
function ForeignWithdraw({ owner, will, refresh }: { owner: string; will: Will; refresh: () => void }) {
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

function WatchSettings({ owner }: { owner: string }) {
  const [evm, setEvm] = useState("");
  const [nearMore, setNearMore] = useState("");
  const [evmMore, setEvmMore] = useState("");
  const [github, setGithub] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const items = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-muted hover:text-ink">Connect more signs of life</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Field label="More NEAR accounts you use" hint="Up to 5. Testnet, or mainnet (.near), read-only.">
          <input className={inputCls} value={nearMore} onChange={(e) => setNearMore(e.target.value)} placeholder="you.near, work.testnet" />
        </Field>
        <Field label="Your Sepolia addresses" hint="Up to 5 more. Not the vault.">
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
            const data: Record<string, unknown> = {};
            if (evm) data.evm_address = evm;
            if (github) data.github = github;
            if (nearMore.trim()) data.near_accounts = items(nearMore).map((x) => x.toLowerCase());
            if (evmMore.trim()) data.evm_addresses = items(evmMore);
            await agent.registerOwner(await signRequest(owner, "register_owner", data));
            setSaved("Saved. The agent checks every 15 seconds.");
          }}
        >
          Save
        </ActionButton>
        {saved && <span className="ml-2 text-xs text-accent">{saved}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">Empty keeps what&apos;s saved. A list replaces the saved list.</p>
    </details>
  );
}

/**
 * Email for checks and alerts: the owner's own address, and one for each person in the will. Kept by the
 * agent in the enclave, never on-chain; the app shows only that an email went out, not to whom.
 */
function EmailAlerts({ will }: { will: Will }) {
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

function SealedNotes({ will, refresh }: { will: Will; refresh: () => void }) {
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
function SetupSummary({ stagesPct, demoClock, quietDays = null }: { stagesPct: number[]; demoClock: boolean; quietDays?: number | null }) {
  const preset = demoClock ? DEMO_SCHEDULE : realSchedule(quietDays);
  const sum = summarize(preset.timings, stagesFor(stagesPct, preset));
  return (
    <p className="rounded-md border border-line bg-accent-soft p-3 text-sm">
      If you go quiet: first slice ≈ <b>{duration(sum.earliestMove)}</b>, all handed over ≈{" "}
      <b>{duration(sum.fullDistribution)}</b>, notes ≈ <b>{duration(sum.secrets)}</b>. A sign of life stops it.
    </p>
  );
}
