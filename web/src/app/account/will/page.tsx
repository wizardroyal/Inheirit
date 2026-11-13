"use client";
// My will (round 5): status and actions at the top, the will in plain words (always real timings; a
// Speedrun badge instead of minutes), then sections that each open for editing with ⚙.
import Link from "next/link";
import { useEffect, useState } from "react";
import { FinishSetup, WillGate } from "@/components/account/home";
import { CloseWill } from "@/components/account/will";
import { CreateWill, LowBalance } from "@/components/account/parts";
import { Icon } from "@/components/icons";
import { ActionButton, Avatar, Card, ConfirmButton, ErrorNote, Field, GearButton, inputCls, Pill, Stepper } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { agent } from "@/lib/agent";
import { REAL_SCHEDULE, SITE_URL } from "@/lib/config";
import { acceptAsGuardians, savedPolicy } from "@/lib/demo";
import { peopleOf, saveWillPeople, type WillPeople } from "@/lib/edit-will";
import { useOverview, usePoll } from "@/lib/hooks";
import { keys } from "@/lib/keys";
import { accountLabel, nameOf, useAccountLabel, useNames } from "@/lib/names";
import { call, formatNear } from "@/lib/near";
import { cancelInvite, createInvite, nameClaimedInvites, useOpenInvites, type InviteRole, type OpenInvite } from "@/lib/invites";
import { createPerson } from "@/lib/onboard";
import { newTestReceive } from "@/lib/test-wallets";
import { newId, useProfile, type Person } from "@/lib/profile";
import { isSpeedrun } from "@/lib/speedrun";
import { dateText, duration, pausedUntil, schedule, stateLabel, stateName, type Will } from "@/lib/will";

export default function MyWillPage() {
  const { owner, will, loaded, viewing, creating, setCreating, refresh } = useAccount();
  // Wills are created here (a saved draft opens in the same form).
  if (loaded && !viewing && (!will || creating))
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-3xl sm:text-4xl">Create your will</h1>
        {!creating && <LowBalance owner={owner} />}
        <CreateWill owner={owner} onCreating={setCreating} onCreated={refresh} />
      </div>
    );
  return <WillGate>{(w) => <MyWill will={w} />}</WillGate>;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function StatusBar({ status, children }: { status: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="font-serif text-3xl sm:text-4xl">My will</h1>
      <Pill tone={status === "Active" ? "accent" : status === "Draft" ? "neutral" : "warn"}>{status}</Pill>
      <span className="ml-auto flex flex-wrap items-center gap-2">{children}</span>
    </div>
  );
}

const btn = "inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 py-2 hover:bg-accent-soft";

/** Try a speedrun and Pause (1-90 days, from All good), or Resume. Close is at the bottom of the page. */
function Actions({ will }: { will: Will }) {
  const { refresh } = useAccount();
  const [pausing, setPausing] = useState(false);
  const [days, setDays] = useState(30);
  const s = stateName(will.state);
  // Testnet: any will can be run on a clock of minutes to see how it would execute.
  const speedrun = (
    <Link href="/account/speedrun" className={btn}>
      <Icon name="ff" className="h-4 w-4" />
      {isSpeedrun(will) ? "Speedrun" : "Try a speedrun"}
    </Link>
  );
  if (s === "Paused")
    return (
      <ActionButton onClick={() => call(will.owner, "resume_will").then(refresh)}>
        <span className="inline-flex items-center gap-2">
          <Icon name="play" className="h-4 w-4" /> Resume
        </span>
      </ActionButton>
    );
  if (s !== "Active") return isSpeedrun(will) ? speedrun : null;
  return (
    <>
      {speedrun}
      {pausing ? (
        <span className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-2">
          <span>Pause for</span>
          <Stepper label="days to pause" value={days} min={1} max={90} onChange={setDays} />
          <span>days</span>
          <ActionButton onClick={() => call(will.owner, "pause_will", { days }).then(() => (setPausing(false), refresh()))}>Pause</ActionButton>
          <button type="button" className="min-h-11 px-2 text-muted underline" onClick={() => setPausing(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className={btn} onClick={() => setPausing(true)}>
          <Icon name="pause" className="h-4 w-4" /> Pause
        </button>
      )}
    </>
  );
}

/** The will in plain words, always with real timings (a speedrun shows a badge instead of minutes). */
function WillText({ will }: { will: Will }) {
  const names = useNames();
  const { data: overview } = useOverview(will.owner);
  const { data: tokens } = usePoll(() => agent.intentsTokens().catch(() => null), 10 * 60_000, []);
  const nearUsd = tokens?.tokens.find((t) => t.symbol === "wNEAR" && t.blockchain === "near")?.price ?? null;
  const policy = savedPolicy(will.owner);
  const name = overview?.display_name ?? nameOf(will.owner) ?? "the owner";
  const vault = Number(formatNear(will.near_balance));
  const speedrun = isSpeedrun(will);
  const t = speedrun ? REAL_SCHEDULE.timings : will.timings;
  const total = speedrun ? REAL_SCHEDULE.firstWait + REAL_SCHEDULE.wait * (will.stages.length - 2) : schedule(will).slice(0, -1).reduce((s, x) => s + x.wait_after, 0);
  const foreign = will.foreign_chains.map((c) => (c === "Eth" ? "Ethereum" : "Bitcoin"));
  const sentences = will.heirs.map((h) => {
    const pct = h.near_share_bps / 100;
    const value = nearUsd && vault ? ` (≈ $${Math.round(vault * (pct / 100) * nearUsd).toLocaleString()} at mainnet prices)` : "";
    const id = policy?.heirs.find((p) => p.near_account === h.account_id)?.id;
    const other = foreign.map((label) => {
      const share = id ? policy?.allocations.find((a) => a.asset === (label === "Ethereum" ? "ETH" : "BTC"))?.shares[id] : pct;
      return share === 100 ? `all my ${label}` : share ? `${share}% of my ${label}` : null;
    });
    return `${h.name} receives ${list([`${pct}% of my NEAR${value}`, ...other.filter((x): x is string => !!x)])}.`;
  });
  const g = will.guardians.map((x) => accountLabel(x.account_id, names));
  return (
    <section className="rounded-2xl border border-line bg-card p-6 sm:p-8">
      {speedrun && (
        <p className="mb-4">
          <Pill tone="warn">Speedrun</Pill> <span className="text-sm text-muted">Running in minutes for trying it; the will below reads in real time.</span>
        </p>
      )}
      <div className="max-w-2xl space-y-3 font-serif text-xl leading-relaxed">
        <p>
          I, {name}, leave my assets to {list(will.heirs.map((h) => h.name))}. {sentences.join(" ")}
        </p>
        <p>
          If I go quiet for {duration(t.quiet_after)}, my guardians {list(g)} (any {will.guardian_threshold}) are asked to confirm. My assets are released in {will.stages.length} stages
          over about {duration(total)}, the longest wait after the first.{will.sealed_notes.length > 0 ? ` My final secrets reach my heirs last, ${duration(t.secrets_buffer)} after that.` : ""}
        </p>
      </div>
    </section>
  );
}

function MyWill({ will }: { will: Will }) {
  const { viewing } = useAccount();
  const s = stateName(will.state);
  const until = pausedUntil(will);
  const status = until ? `Paused until ${dateText(until)}` : s === "Completed" ? "Completed" : s === "Active" ? "Active" : stateLabel(s);
  const editable = s === "Active" && !viewing;
  const st = schedule(will);
  const speedrun = isSpeedrun(will);
  return (
    <div className="space-y-6">
      <StatusBar status={status}>{!viewing && <Actions will={will} />}</StatusBar>
      <FinishSetup will={will} />
      {s !== "Active" && s !== "Paused" && <p className="text-muted">Now: {stateLabel(s)}. Changes can be made only at All good.</p>}
      <WillText will={will} />
      <HeirsSection will={will} editable={editable} />
      <GuardiansSection will={will} editable={editable} />
      <LawyerFriendsSection will={will} editable={editable} />
      <Card title="Schedule">
        <ol className="space-y-2 text-lg">
          {st.map((x, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-3">
              <span>
                Stage {i + 1}: {x.pct}%
              </span>
              <span className="text-muted">
                then wait {duration(speedrun ? (i === 0 ? REAL_SCHEDULE.firstWait : REAL_SCHEDULE.wait) : x.wait_after)}
                {speedrun && ` (speedrun: ${duration(x.wait_after)})`}
              </span>
            </li>
          ))}
          <li className="flex flex-wrap justify-between gap-3 text-muted">
            <span>Final secrets</span>
            <span>
              after {duration(speedrun ? REAL_SCHEDULE.timings.secrets_buffer : will.timings.secrets_buffer)} more
              {speedrun && ` (speedrun: ${duration(will.timings.secrets_buffer)})`}
            </span>
          </li>
        </ol>
      </Card>
      {!viewing && (s === "Active" || s === "Paused") && (
        <div id="close">
          <CloseWill will={will} />
        </div>
      )}
    </div>
  );
}

function PersonRow({ name, right }: { name: string; right?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <Avatar name={name} />
      <span className="min-w-0 flex-1 truncate text-lg">{name}</span>
      {right}
    </li>
  );
}

function CopyButton({ text, label = "Copy invite" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-1 text-sm hover:bg-accent-soft"
      onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true), () => window.prompt("Copy this link:", text))}
    >
      <Icon name="copy" className="h-4 w-4" />
      {done ? "Copied" : label}
    </button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-line px-4 py-2 hover:bg-accent-soft" onClick={onClick}>
      <Icon name="plus" className="h-4 w-4" /> {label}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="min-h-11 px-3 text-muted underline" onClick={onClick}>
      Remove
    </button>
  );
}

function EditorButtons({ onSave, onCancel, disabled }: { onSave: () => Promise<unknown>; onCancel: () => void; disabled?: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <ActionButton disabled={disabled} onClick={onSave}>
        Save
      </ActionButton>
      <button type="button" className="min-h-11 px-3 text-muted underline" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** A wallet box with ↻ next to it that fills a fresh test address. */
function WalletInput({ label, value, onChange, fill }: { label: string; value: string; onChange: (v: string) => void; fill: () => void }) {
  return (
    <Field label={label}>
      <span className="flex gap-2">
        <input className={`${inputCls} min-w-0 flex-1`} value={value} onChange={(e) => onChange(e.target.value.trim())} />
        <button type="button" title="Make a test wallet" aria-label={`Make a test ${label.toLowerCase()}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line hover:bg-accent-soft" onClick={fill}>
          <Icon name="refresh" className="h-4 w-4" />
        </button>
      </span>
    </Field>
  );
}

type HeirRow = WillPeople["heirs"][number];

/** Heirs: shares and Remove under ⚙; "Add heir" opens a small form (name and wallets, or someone from Profile). */
function HeirsSection({ will, editable }: { will: Will; editable: boolean }) {
  const { refresh } = useAccount();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [p, setP] = useState<WillPeople>(() => peopleOf(will));
  // What's typed in each share box, so "33." can become "33.5".
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const total = p.heirs.reduce((s, h) => s + (Number(h.pct) || 0), 0);
  const close = () => (setEditing(false), setAdding(false), setErr(null), setRaw({}));
  const open = () => (setP(peopleOf(will)), setRaw({}), setEditing(true));
  return (
    <Card title="Heirs" aside={editable ? <GearButton open={editing} label="Edit heirs" onClick={() => (editing ? close() : open())} /> : undefined}>
      <ul className="divide-y divide-line">
        {(editing ? p.heirs : peopleOf(will).heirs).map((h, i) => (
          <PersonRow
            key={h.account_id}
            name={h.name}
            right={
              editing ? (
                <>
                  <span className="relative">
                    <input
                      className={`${inputCls} w-24 pr-7`}
                      inputMode="decimal"
                      aria-label={`${h.name}'s share in percent`}
                      value={raw[h.account_id] ?? h.pct}
                      onChange={(e) => (setRaw({ ...raw, [h.account_id]: e.target.value }), setP({ ...p, heirs: p.heirs.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) || 0 } : x)) }))}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
                  </span>
                  {p.heirs.length > 1 && <RemoveButton onClick={() => setP({ ...p, heirs: p.heirs.filter((_, j) => j !== i) })} />}
                </>
              ) : (
                <span className="text-lg text-muted">{h.pct}%</span>
              )
            }
          />
        ))}
      </ul>
      {editing && <p className={total === 100 ? "text-muted" : "text-danger"}>Shares: {total}% of 100%</p>}
      {editable &&
        (adding ? (
          <AddHeir
            will={will}
            taken={[...(editing ? p : peopleOf(will)).heirs.map((h) => h.account_id), ...will.guardians.map((g) => g.account_id), ...will.contacts, ...(will.lawyer ? [will.lawyer] : [])]}
            onCancel={() => setAdding(false)}
            onAdd={(h) => {
              const base = editing ? p : peopleOf(will);
              setP({ ...base, heirs: [...base.heirs, h] });
              setEditing(true);
              setAdding(false);
            }}
          />
        ) : (
          <AddButton label="Add heir" onClick={() => setAdding(true)} />
        ))}
      {err && <ErrorNote>{err}</ErrorNote>}
      {editing && (
        <EditorButtons
          disabled={total !== 100}
          onCancel={close}
          onSave={async () => {
            setErr(null);
            try {
              await saveWillPeople(will, p);
              refresh();
              close();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </Card>
  );
}

function AddHeir({ will, taken, onAdd, onCancel }: { will: Will; taken: string[]; onAdd: (h: HeirRow) => void; onCancel: () => void }) {
  const [profile, saveProfile] = useProfile(will.owner);
  const [from, setFrom] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [eth, setEth] = useState("");
  const [btc, setBtc] = useState("");
  const [pct, setPct] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const options = profile.people.filter((x) => x.role === "heir" && !(x.account && taken.includes(x.account)));
  const pick = (x: Person) => (setFrom(x), setName(x.name), setEth(x.eth ?? ""), setBtc(x.btc ?? ""));
  const fill = (k: "eth" | "btc") => {
    const r = newTestReceive();
    if (k === "eth") setEth(r.eth);
    else setBtc(r.btc);
  };
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-bg p-4">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={from?.id === x.id}
              className={`min-h-11 rounded-lg border border-dashed border-line px-3 py-2 hover:bg-accent-soft ${from?.id === x.id ? "bg-accent-soft" : ""}`}
              onClick={() => pick(x)}
            >
              {x.name}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={inputCls} maxLength={64} value={name} onChange={(e) => (setName(e.target.value), setFrom(null))} autoFocus />
        </Field>
        <Field label="Share">
          <span className="relative">
            <input className={`${inputCls} w-24 pr-7`} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0" />
            <span className="pointer-events-none absolute left-[4.6rem] top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
          </span>
        </Field>
        <WalletInput label="Ethereum wallet" value={eth} onChange={setEth} fill={() => fill("eth")} />
        <WalletInput label="Bitcoin wallet" value={btc} onChange={setBtc} fill={() => fill("btc")} />
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          disabled={!name.trim()}
          onClick={async () => {
            setErr(null);
            if (eth && !/^0x[0-9a-fA-F]{40}$/.test(eth)) return setErr("An Ethereum wallet starts with 0x and has 40 more characters.");
            if (btc && !/^(tb1|bc1|[mn2])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(btc)) return setErr("That Bitcoin wallet doesn't look right.");
            // Testnet: someone without a NEAR account gets a funded test account (not shown).
            const account = from?.account ?? (await createPerson(will.owner, name.trim())).accountId;
            const row: Person = { ...(from ?? { id: newId(), role: "heir" as const }), name: name.trim(), account, ...(eth ? { eth } : {}), ...(btc ? { btc } : {}) };
            await saveProfile({ people: from ? profile.people.map((x) => (x.id === from.id ? row : x)) : [...profile.people, row] }).catch(() => {});
            onAdd({ account_id: account, name: name.trim(), pct: Number(pct) || 0, eth: eth || undefined, btc: btc || undefined });
          }}
        >
          Add
        </ActionButton>
        <button type="button" className="min-h-11 px-3 text-muted underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Adds a guardian, lawyer or friend: someone from Profile who has an account goes straight onto the will;
 * anyone else is invited by name, and the link to send them shows on their row until they accept.
 */
function AddByName({ will, role, onDone }: { will: Will; role: InviteRole; onDone: () => void }) {
  const { refresh } = useAccount();
  const [profile, saveProfile] = useProfile(will.owner);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const onWill = new Set([...will.heirs.map((h) => h.account_id), ...will.guardians.map((g) => g.account_id), ...will.contacts, ...(will.lawyer ? [will.lawyer] : [])]);
  const options = profile.people.filter((x) => x.role === role && !(x.account && onWill.has(x.account)));
  const addAccount = async (account: string) => {
    const p = peopleOf(will);
    if (role === "guardian") p.guardians = [...p.guardians, account];
    else if (role === "lawyer") p.lawyer = account;
    else p.contacts = [...p.contacts, account];
    await saveWillPeople(will, p);
    // Test people made in this browser accept at once.
    if (role === "guardian" && keys.secret(account)) await acceptAsGuardians(will.owner, [account], () => {});
  };
  const invite = async (n: string, person?: Person) => {
    await createInvite(will.owner, role, n);
    if (!person) await saveProfile({ people: [...profile.people, { id: newId(), name: n, role }] }).catch(() => {});
  };
  const run = (f: () => Promise<unknown>) => async () => {
    setErr(null);
    try {
      await f();
      refresh();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-bg p-4">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map((x) => (
            <ActionButton key={x.id} tone="quiet" onClick={run(() => (x.account ? addAccount(x.account) : invite(x.name, x)))}>
              + {x.name}
            </ActionButton>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Name">
          <input className={`${inputCls} min-w-0`} maxLength={64} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <ActionButton disabled={!name.trim()} onClick={run(() => invite(name.trim()))}>
          Invite
        </ActionButton>
        <button type="button" className="min-h-11 px-3 text-muted underline" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="text-sm text-muted">
        You get a link to send them. Opening it makes them a key to sign in with.
        {role === "guardian" && (
          <>
            {" "}
            Testing alone?{" "}
            <button type="button" className="underline" onClick={run(async () => addAccount((await createPerson(will.owner, name.trim() || undefined)).accountId))}>
              Add a test guardian who accepts now
            </button>
            .
          </>
        )}
      </p>
      {err && <ErrorNote>{err}</ErrorNote>}
    </div>
  );
}

function InviteRows({ invites, editing, owner }: { invites: OpenInvite[]; editing: boolean; owner: string }) {
  return (
    <>
      {invites.map((i) => (
        <PersonRow
          key={i.hash}
          name={i.name || "Invited"}
          right={
            <>
              <Pill tone="warn">invited</Pill>
              {editing ? <ConfirmButton label="Remove" question={`Withdraw ${i.name || "this"} invite?`} onConfirm={() => cancelInvite(owner, i.hash)} /> : i.link && <CopyButton text={i.link} />}
            </>
          }
        />
      ))}
    </>
  );
}

function GuardiansSection({ will, editable }: { will: Will; editable: boolean }) {
  const label = useAccountLabel();
  const { refresh } = useAccount();
  const [invites] = useOpenInvites(will.owner);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [p, setP] = useState<WillPeople>(() => peopleOf(will));
  const [err, setErr] = useState<string | null>(null);
  const key = will.guardians.map((g) => g.account_id).join(",");
  useEffect(() => {
    void nameClaimedInvites(will.owner, [
      ...will.guardians.map((g) => ({ role: "guardian" as const, account: g.account_id })),
      ...will.contacts.map((c) => ({ role: "friend" as const, account: c })),
      ...(will.lawyer ? [{ role: "lawyer" as const, account: will.lawyer }] : []),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [will.owner, key, will.lawyer, will.contacts.join(",")]);
  const close = () => (setEditing(false), setErr(null));
  const pending = invites.filter((i) => i.role === "guardian");
  const shown = editing ? p.guardians : will.guardians.map((g) => g.account_id);
  return (
    <Card title="Guardians" aside={editable ? <GearButton open={editing} label="Edit guardians" onClick={() => (editing ? close() : (setP(peopleOf(will)), setEditing(true)))} /> : undefined}>
      <ul className="divide-y divide-line">
        {shown.map((g) => {
          const accepted = will.guardians.find((x) => x.account_id === g)?.accepted;
          return (
            <PersonRow
              key={g}
              name={label(g)}
              right={
                editing ? (
                  <RemoveButton onClick={() => setP({ ...p, guardians: p.guardians.filter((x) => x !== g), threshold: Math.min(p.threshold, Math.max(1, p.guardians.length - 1)) })} />
                ) : (
                  <>
                    <Pill tone={accepted ? "accent" : "warn"}>{accepted ? "accepted" : "invited"}</Pill>
                    {!accepted && <CopyButton text={`${SITE_URL}/guardian/${will.owner}`} />}
                  </>
                )
              }
            />
          );
        })}
        <InviteRows invites={pending} editing={editing} owner={will.owner} />
      </ul>
      {editing ? (
        <Field label="How many must confirm" group>
          <Stepper label="guardians who must confirm" value={p.threshold} min={1} max={Math.max(1, p.guardians.length)} onChange={(n) => setP({ ...p, threshold: n })} />
        </Field>
      ) : (
        <p className="mt-2 text-muted">
          {will.guardian_threshold} of {will.guardians.length} must confirm.{pending.length ? " Invited people count once they accept." : ""}
        </p>
      )}
      {editable && !editing && (adding ? <AddByName will={will} role="guardian" onDone={() => setAdding(false)} /> : <AddButton label="Add guardian" onClick={() => setAdding(true)} />)}
      {err && <ErrorNote>{err}</ErrorNote>}
      {editing && (
        <EditorButtons
          disabled={p.guardians.length < 1}
          onCancel={close}
          onSave={async () => {
            setErr(null);
            try {
              await saveWillPeople(will, p);
              refresh();
              close();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </Card>
  );
}

function LawyerFriendsSection({ will, editable }: { will: Will; editable: boolean }) {
  const label = useAccountLabel();
  const { refresh } = useAccount();
  const [invites] = useOpenInvites(will.owner);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<InviteRole | null>(null);
  const [p, setP] = useState<WillPeople>(() => peopleOf(will));
  const [err, setErr] = useState<string | null>(null);
  const cur = editing ? p : peopleOf(will);
  const lawyerInvite = invites.filter((i) => i.role === "lawyer");
  const friendInvites = invites.filter((i) => i.role === "friend");
  const close = () => (setEditing(false), setErr(null));
  return (
    <Card title="Lawyer and friends" aside={editable ? <GearButton open={editing} label="Edit lawyer and friends" onClick={() => (editing ? close() : (setP(peopleOf(will)), setEditing(true)))} /> : undefined}>
      <ul className="divide-y divide-line">
        {cur.lawyer && <PersonRow name={label(cur.lawyer)} right={editing ? <RemoveButton onClick={() => setP({ ...p, lawyer: null })} /> : <span className="text-muted">Lawyer</span>} />}
        <InviteRows invites={lawyerInvite} editing={editing} owner={will.owner} />
        {cur.contacts.map((c) => (
          <PersonRow key={c} name={label(c)} right={editing ? <RemoveButton onClick={() => setP({ ...p, contacts: p.contacts.filter((x) => x !== c) })} /> : <span className="text-muted">Friend</span>} />
        ))}
        <InviteRows invites={friendInvites} editing={editing} owner={will.owner} />
      </ul>
      {!cur.lawyer && !cur.contacts.length && !invites.some((i) => i.role !== "guardian") && <p className="text-muted">Friends can only stop things; a lawyer can speed up the release, never skip a step.</p>}
      {editable &&
        !editing &&
        (adding ? (
          <AddByName will={will} role={adding} onDone={() => setAdding(null)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {!will.lawyer && !lawyerInvite.length && <AddButton label="Add lawyer" onClick={() => setAdding("lawyer")} />}
            <AddButton label="Add friend" onClick={() => setAdding("friend")} />
          </div>
        ))}
      {err && <ErrorNote>{err}</ErrorNote>}
      {editing && (
        <EditorButtons
          onCancel={close}
          onSave={async () => {
            setErr(null);
            try {
              await saveWillPeople(will, p);
              refresh();
              close();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </Card>
  );
}
