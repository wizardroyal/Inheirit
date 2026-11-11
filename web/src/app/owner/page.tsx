"use client";
import { accountLabel, ensureName, humanize, rememberOwner, useAccountLabel, useNames } from "@/lib/names";
import { summarizePolicy, type Policy } from "@agent/policy/policy";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AgentBadge, AiBadge } from "@/components/Attestation";
import { Ladder } from "@/components/Ladder";
import { ActionButton, Card, CopyLink, Details, ErrorNote, Field, inputCls, Pill } from "@/components/ui";
import { QuickSetup, StrengthChecklist } from "@/components/Onboarding";
import { FundAnywhere, PayoutsPanel } from "@/components/Payouts";
import { SignIn } from "@/components/SignIn";
import { SignsOfLife } from "@/components/SignsOfLife";
import { Speedrun } from "@/components/Speedrun";
import { Vaults } from "@/components/Vaults";
import { NotificationLog, Releases, SignalList, WatchStatus } from "@/components/WillParts";
import { agent, type DraftResult } from "@/lib/agent";
import { DEMO_SCHEDULE, REAL_SCHEDULE } from "@/lib/config";
import { stagesFor, summarize } from "@agent/policy/schedule";
import { addSealedNote, createWill, generateWillAndCast } from "@/lib/demo";
import { useKeys, useMyAccounts, usePoll, useWill } from "@/lib/hooks";
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

function Owner() {
  const params = useSearchParams();
  const [owner, setOwner] = useState(params.get("as") ?? "");
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
            <AccountActions owner={owner} onSignIn={() => setSigningIn(true)} onSignedOut={() => setOwner("")} />
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
      {owner && loaded && (!will || creating) && <LowBalance owner={owner} />}
      {owner && loaded && (!will || creating) && <CreateWill owner={owner} onCreating={setCreating} onCreated={refresh} />}
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
        You have {formatNear(balance)} NEAR. Creating a will and funding its vault takes about 1 NEAR. Testnet NEAR is free, so we can send you
        some:
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

/** Three tabs: My will (default), Will in plain English (drafted by NEAR AI), Generate sample will. */
function CreateWill(props: { owner: string; onCreating: (b: boolean) => void; onCreated: () => void }) {
  const [mode, setMode] = useState<"generate" | "quick" | "english">("quick");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <ActionButton tone={mode === "quick" ? undefined : "quiet"} onClick={async () => setMode("quick")}>
          My will
        </ActionButton>
        <ActionButton tone={mode === "english" ? undefined : "quiet"} onClick={async () => setMode("english")}>
          Will in plain English
        </ActionButton>
        <ActionButton tone={mode === "generate" ? undefined : "quiet"} onClick={async () => setMode("generate")}>
          Generate sample will
        </ActionButton>
      </div>
      {mode === "generate" ? (
        <GenerateWill {...props} />
      ) : mode === "quick" ? (
        <QuickSetup {...props} summary={(stagesPct, demoClock) => <SetupSummary stagesPct={stagesPct} demoClock={demoClock} />} />
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
        The quickest way to see everything. This creates test people (an heir, three guardians, a friend and a lawyer, with new names each time)
        whose keys stay in this browser, so you can play every role. Then it writes your will (everything to the heir, released 10% → 20% → 30% →
        40%), the guardians accept, and a sealed note is left for the heir. You can change any of it later while the will is at All good.
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
          <input type="checkbox" checked={stable} onChange={(e) => setStable(e.target.checked)} /> Pay the heir in dollars (stable value via NEAR Intents, SIMULATED on testnet)
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
        Sepolia ETH and testnet BTC come from a small demo pool while it lasts. If the pool is empty, those vaults stay empty and only NEAR moves.
      </p>
      <div className="mt-3">
        <SetupSummary stagesPct={[10, 20, 30, 40]} demoClock={demoClock} />
      </div>
      <div className="mt-3">
        <ActionButton
          onClick={async () => {
            setLog([]);
            setFailed(false);
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
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [demoClock, setDemoClock] = useState(true);
  const [contacts, setContacts] = useState("");
  const [deposit, setDeposit] = useState("0.5");
  const [log, setLog] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const policy = draft?.ok ? (draft.policy as Policy) : null;
  const assets = new Set(policy?.allocations.map((a) => a.asset));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Card title="Write it in plain English">
        <p className="mb-3 text-sm text-muted">
          Say who gets what, and who your guardians are. A private model on NEAR AI Cloud turns it into a structured will, and nothing is saved
          until you approve the summary.
        </p>
        <textarea
          className={`${inputCls} h-40 w-full`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`I leave all my NEAR to my son Tobi (tobi.testnet). My guardians are g1.testnet, g2.testnet and g3.testnet; two of them must confirm.`}
        />
        <div className="mt-3">
          <ActionButton
            disabled={text.trim().length < 10}
            onClick={async () => {
              setDraft(null);
              setDraft(await agent.draftPolicy(await signRequest(owner, "draft_policy", { text })));
            }}
          >
            Draft my will
          </ActionButton>
        </div>
        {draft && !draft.ok && (
          <div className="mt-4 space-y-2">
            <ErrorNote>The draft doesn&apos;t add up yet. We never fix a will silently, so please reword it and try again.</ErrorNote>
            <ul className="list-disc pl-5 text-sm">
              {draft.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {policy && (
          <div className="mt-4 space-y-3">
            <h3 className="font-serif text-lg">Please check this summary</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {summarizePolicy(policy).map((l) => (
                <li key={l}>{humanize(l, names)}</li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              This summary is written by our code from the checked will, not by the model. The model&apos;s answer was signed inside its enclave:{" "}
              {draft?.ai.signature?.ok ? "signature verified" : "signature not verified"}.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Friends for a welfare check (optional)" hint="NEAR accounts, separated by commas">
                <input className={inputCls} value={contacts} onChange={(e) => setContacts(e.target.value)} placeholder="friend.testnet" />
              </Field>
              <Field label="NEAR to put in the vault now">
                <input className={inputCls} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={demoClock} onChange={(e) => setDemoClock(e.target.checked)} />
              Demo clock: quiet after {duration(DEMO_SCHEDULE.timings.quiet_after)} instead of {duration(REAL_SCHEDULE.timings.quiet_after)}
            </label>
            <SetupSummary stagesPct={policy.stages_pct} demoClock={demoClock} />
            <ActionButton
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
                    schedule: demoClock ? DEMO_SCHEDULE : REAL_SCHEDULE,
                    foreignChains: [...(assets.has("ETH") ? ["Eth" as const] : []), ...(assets.has("BTC") ? ["Btc" as const] : [])],
                    depositNear: deposit,
                  },
                  (m) => setLog((l) => [...l, m]),
                );
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
          Your words go only to a model running in a sealed enclave, which the agent has just checked (Intel TDX quote, NVIDIA GPU attestation, a
          signing key bound to a fresh nonce). Its answer must be signed by that same key, or it&apos;s thrown away.
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
            <span className="text-xs text-muted">Cancels any stage, even mid-release. In normal life you never need to press it.</span>
          </div>
        </Card>
        <Card title="Signs of life the agent watches for">
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
                {will.guardians.map((g) => `${label(g.account_id)}${g.accepted ? "" : " (invited, hasn't accepted yet)"}`).join(", ")}
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
                Not armed yet: {will.guardian_threshold} guardian{will.guardian_threshold > 1 ? "s" : ""} must accept before anything can ever
                happen. Send them this link:
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
      </div>
      <div className="min-w-0 space-y-6">
        <StrengthChecklist will={will} />
        <Vaults owner={owner} will={will}>
          {active ? (
            <NearVaultActions owner={owner} refresh={refresh} />
          ) : (
            <p className="mt-2 text-xs text-muted">You can deposit and withdraw while the will is at All good.</p>
          )}
          {active && will.foreign_chains.length > 0 && <ForeignWithdraw owner={owner} will={will} refresh={refresh} />}
          {will.pending_withdrawals.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {will.pending_withdrawals.map((w) => (
                <li key={w.id}>
                  Withdrawal to {w.to} on {w.chain === "Eth" ? "Sepolia" : w.chain === "Btc" ? "Bitcoin testnet" : "NEAR"}: the agent is sending it
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
        <Card title="Messages sent">
          <NotificationLog owner={owner} />
        </Card>
        <Card title="Why you can trust the agent">
          <AgentBadge />
        </Card>
      </div>
      </div>
    </div>
  );
}

function NearVaultActions({ owner, refresh }: { owner: string; refresh: () => void }) {
  const [amount, setAmount] = useState("0.1");
  return (
    <div className="mt-3 flex flex-wrap items-start gap-2">
      <input className={`${inputCls} w-24`} value={amount} onChange={(e) => setAmount(e.target.value)} />
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
        <input className={`${inputCls} w-28`} placeholder={`amount (${unit})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
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
  const [github, setGithub] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-muted hover:text-ink">Add more signs of life</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Field label="Your own Sepolia address" hint="Not the vault. Transactions you send from it count as signs of life.">
          <input className={inputCls} value={evm} onChange={(e) => setEvm(e.target.value.trim())} placeholder="0x…" />
        </Field>
        <Field label="GitHub username" hint="Only public activity, and only its time.">
          <input className={inputCls} value={github} onChange={(e) => setGithub(e.target.value.trim())} />
        </Field>
      </div>
      <div className="mt-2">
        <ActionButton
          tone="quiet"
          onClick={async () => {
            const data: Record<string, string> = {};
            if (evm) data.evm_address = evm;
            if (github) data.github = github;
            await agent.registerOwner(await signRequest(owner, "register_owner", data));
            setSaved("Saved. The agent checks every 15 seconds.");
          }}
        >
          Save
        </ActionButton>
        {saved && <span className="ml-2 text-xs text-accent">{saved}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">Leave a field empty to keep what&apos;s saved. Your NEAR account and the heartbeat app always count.</p>
    </details>
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
        Encrypted in this browser to a key held only inside the agent&apos;s enclave; only the scrambled text goes on-chain. Notes are released
        last, one heir at a time: after everything is distributed and one more wait, the agent re-seals each note to its heir&apos;s own key.
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
        {will.sealed_notes.length === 0 && <li className="text-muted">No notes yet. Notes are optional.</li>}
      </ul>
      {active && (
        <div className="mt-4 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={inputCls} value={heir} onChange={(e) => setHeir(e.target.value)}>
              {will.heirs.map((h) => (
                <option key={h.account_id} value={h.account_id}>
                  for {h.name}
                </option>
              ))}
            </select>
            <input className={inputCls} placeholder="Title (anyone can see it on-chain)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={64} />
          </div>
          <textarea className={`${inputCls} h-24 w-full`} placeholder="What should they know? (Encrypted before it leaves this page.)" value={text} onChange={(e) => setText(e.target.value)} />
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
            Tip: instructions beat raw keys. Write where the hardware wallet is and who holds the passphrase, or split a seed phrase from its
            passphrase across notes and people.
          </p>
        </div>
      )}
      {will.released_notes.length > 0 && <p className="mt-2 text-xs text-muted">Last release {ago(will.released_notes[will.released_notes.length - 1].at)}.</p>}
    </Card>
  );
}

/** "If you go quiet: earliest anything moves ≈ X; full distribution ≈ Y; secrets ≈ Z." (CLAUDE.md §8) */
function SetupSummary({ stagesPct, demoClock }: { stagesPct: number[]; demoClock: boolean }) {
  const preset = demoClock ? DEMO_SCHEDULE : REAL_SCHEDULE;
  const sum = summarize(preset.timings, stagesFor(stagesPct, preset));
  return (
    <p className="rounded-md border border-line bg-accent-soft p-3 text-sm">
      If you go quiet, the earliest anything moves is after about <b>{duration(sum.earliestMove)}</b>. Everything is handed over after about{" "}
      <b>{duration(sum.fullDistribution)}</b>, and sealed notes after about <b>{duration(sum.secrets)}</b>. Any sign of life before then stops
      it.
    </p>
  );
}
