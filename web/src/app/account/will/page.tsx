"use client";
// My will (round 5): status and actions at the top, the will in plain words (always real timings; a
// Speedrun badge instead of minutes), then sections that each open for editing with ⚙.
import Link from "next/link";
import { useState } from "react";
import { WillGate } from "@/components/account/home";
import { InviteByLink } from "@/components/account/parts";
import { CloseWill } from "@/components/account/will";
import { ActionButton, Avatar, Card, ErrorNote, Field, GearButton, inputCls, Pill, Stepper } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { agent } from "@/lib/agent";
import { REAL_SCHEDULE } from "@/lib/config";
import { acceptAsGuardians, savedPolicy } from "@/lib/demo";
import { peopleOf, saveWillPeople, type WillPeople } from "@/lib/edit-will";
import { useOverview, usePoll } from "@/lib/hooks";
import { keys } from "@/lib/keys";
import { accountLabel, nameOf, useAccountLabel, useNames } from "@/lib/names";
import { call, formatNear } from "@/lib/near";
import { createPerson } from "@/lib/onboard";
import { useProfile, type Role } from "@/lib/profile";
import { isSpeedrun } from "@/lib/speedrun";
import { dateText, duration, pausedUntil, schedule, stateLabel, stateName, type Will } from "@/lib/will";

export default function MyWillPage() {
  const { owner, will, loaded, viewing } = useAccount();
  const [profile] = useProfile(owner);
  // A draft lives off-chain until Start.
  if (loaded && !will && !viewing && (profile.draft as { v?: number } | undefined)?.v === 1)
    return (
      <div className="space-y-6">
        <StatusBar status="Draft" />
        <Card>
          <p className="text-lg">Your will is a draft. Nothing is on-chain and nothing watches for silence until you start it.</p>
          <Link href="/account" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink">
            Continue and start
          </Link>
        </Card>
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

/** Pause (1-90 days, from All good), Resume, and a jump to Close. */
function Actions({ will }: { will: Will }) {
  const { refresh } = useAccount();
  const [pausing, setPausing] = useState(false);
  const [days, setDays] = useState(30);
  const s = stateName(will.state);
  // Testnet: any will can be run on a clock of minutes to see how it would execute.
  const speedrun = (
    <Link href="/account/speedrun" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 py-2 hover:bg-accent-soft">
      {isSpeedrun(will) ? "Speedrun" : "Try a speedrun"}
    </Link>
  );
  if (s === "Paused")
    return <ActionButton onClick={() => call(will.owner, "resume_will").then(refresh)}>Resume</ActionButton>;
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
        <button type="button" className="min-h-11 rounded-lg border border-line px-4 py-2 hover:bg-accent-soft" onClick={() => setPausing(true)}>
          Pause
        </button>
      )}
      <a href="#close" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 py-2 hover:bg-danger-soft hover:text-danger">
        Close
      </a>
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
    const value = nearUsd && vault ? ` (≈ $${Math.round(vault * (pct / 100) * nearUsd).toLocaleString()} today)` : "";
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
  const status = until ? `Paused until ${dateText(until)}` : s === "Completed" ? "Completed" : "Active";
  const editable = s === "Active" && !viewing;
  const st = schedule(will);
  return (
    <div className="space-y-6">
      <StatusBar status={status}>{!viewing && <Actions will={will} />}</StatusBar>
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
              <span className="text-muted">then wait {duration(x.wait_after)}</span>
            </li>
          ))}
          <li className="flex flex-wrap justify-between gap-3 text-muted">
            <span>Final secrets</span>
            <span>after {duration(will.timings.secrets_buffer)} more</span>
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

/** A section card with ⚙ to edit in place. */
function Section({ title, editable, children, editor }: { title: string; editable: boolean; children: React.ReactNode; editor: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title={title} aside={editable ? <GearButton open={open} label={`Edit ${title.toLowerCase()}`} onClick={() => setOpen(!open)} /> : undefined}>
      {open ? editor(() => setOpen(false)) : children}
    </Card>
  );
}

function PersonRow({ name, right }: { name: string; right?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Avatar name={name} />
      <span className="min-w-0 flex-1 truncate text-lg">{name}</span>
      {right}
    </li>
  );
}

/** Save with update_will; show the error under the button. */
function useSave(will: Will, close: () => void) {
  const { refresh } = useAccount();
  return async (next: WillPeople) => {
    await saveWillPeople(will, next);
    refresh();
    close();
  };
}

/** Picks a person for a role: from Profile (with a NEAR account), by account, or a new test person. */
function AddPerson({ owner, role, taken, onAdd }: { owner: string; role: Role; taken: string[]; onAdd: (account: string, name: string) => void }) {
  const [profile] = useProfile(owner);
  const [account, setAccount] = useState("");
  const options = profile.people.filter((p) => p.role === role && p.account && !taken.includes(p.account));
  return (
    <div className="space-y-2">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map((p) => (
            <button key={p.id} type="button" className="min-h-11 rounded-lg border border-dashed border-line px-3 py-2 hover:bg-accent-soft" onClick={() => onAdd(p.account!, p.name)}>
              + {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="NEAR account">
          <input className={inputCls} value={account} onChange={(e) => setAccount(e.target.value.trim())} placeholder="ada.testnet" />
        </Field>
        <ActionButton tone="quiet" disabled={!/^[a-z0-9._-]{2,64}$/.test(account) || taken.includes(account)} onClick={async () => (onAdd(account, nameOf(account) ?? account.split(".")[0]), setAccount(""))}>
          Add
        </ActionButton>
        <ActionButton tone="quiet" onClick={async () => { const p = await createPerson(owner); onAdd(p.accountId, p.name); }}>
          New test person
        </ActionButton>
      </div>
    </div>
  );
}

function HeirsSection({ will, editable }: { will: Will; editable: boolean }) {
  return (
    <Section
      title="Heirs"
      editable={editable}
      editor={(close) => <HeirsEditor will={will} close={close} />}
    >
      <ul className="divide-y divide-line">
        {will.heirs.map((h) => (
          <PersonRow key={h.account_id} name={h.name} right={<span className="text-lg text-muted">{h.near_share_bps / 100}%</span>} />
        ))}
      </ul>
    </Section>
  );
}

function HeirsEditor({ will, close }: { will: Will; close: () => void }) {
  const [p, setP] = useState(() => peopleOf(will));
  const [profile] = useProfile(will.owner);
  const save = useSave(will, close);
  const total = p.heirs.reduce((s, h) => s + (Number(h.pct) || 0), 0);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {p.heirs.map((h, i) => (
          <li key={h.account_id} className="flex flex-wrap items-center gap-3 py-2">
            <Avatar name={h.name} />
            <span className="min-w-0 flex-1 truncate text-lg">{h.name}</span>
            <span className="relative">
              <input
                className={`${inputCls} w-24 pr-7`}
                inputMode="decimal"
                aria-label={`${h.name}'s share in percent`}
                value={h.pct}
                onChange={(e) => setP({ ...p, heirs: p.heirs.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) || 0 } : x)) })}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
            </span>
            {p.heirs.length > 1 && (
              <button type="button" className="min-h-11 px-3 text-muted underline" onClick={() => setP({ ...p, heirs: p.heirs.filter((_, j) => j !== i) })}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className={total === 100 ? "text-muted" : "text-danger"}>Shares: {total}% of 100%</p>
      <AddPerson
        owner={will.owner}
        role="heir"
        taken={[...p.heirs.map((h) => h.account_id), ...p.guardians]}
        onAdd={(account, name) => {
          const pp = profile.people.find((x) => x.account === account);
          setP({ ...p, heirs: [...p.heirs, { account_id: account, name, pct: 0, eth: pp?.eth, btc: pp?.btc }] });
        }}
      />
      <EditorButtons onSave={() => save(p)} onCancel={close} disabled={total !== 100} />
    </div>
  );
}

function GuardiansSection({ will, editable }: { will: Will; editable: boolean }) {
  const label = useAccountLabel();
  return (
    <Section title="Guardians" editable={editable} editor={(close) => <GuardiansEditor will={will} close={close} />}>
      <ul className="divide-y divide-line">
        {will.guardians.map((g) => (
          <PersonRow key={g.account_id} name={label(g.account_id)} right={<Pill tone={g.accepted ? "accent" : "warn"}>{g.accepted ? "accepted" : "invited"}</Pill>} />
        ))}
      </ul>
      <p className="mt-2 text-muted">
        {will.guardian_threshold} of {will.guardians.length} must confirm. Invited guardians accept on their page: <Link className="text-accent underline" href={`/guardian/${will.owner}`}>guardian page</Link>.
      </p>
    </Section>
  );
}

function GuardiansEditor({ will, close }: { will: Will; close: () => void }) {
  const [p, setP] = useState(() => peopleOf(will));
  const label = useAccountLabel();
  const { refresh } = useAccount();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {p.guardians.map((g) => (
          <PersonRow
            key={g}
            name={label(g)}
            right={
              <button type="button" className="min-h-11 px-3 text-muted underline" onClick={() => setP({ ...p, guardians: p.guardians.filter((x) => x !== g), threshold: Math.min(p.threshold, Math.max(1, p.guardians.length - 1)) })}>
                Remove
              </button>
            }
          />
        ))}
      </ul>
      <Field label="How many must confirm" group>
        <Stepper label="guardians who must confirm" value={p.threshold} min={1} max={Math.max(1, p.guardians.length)} onChange={(n) => setP({ ...p, threshold: n })} />
      </Field>
      <AddPerson owner={will.owner} role="guardian" taken={[...p.guardians, ...p.heirs.map((h) => h.account_id)]} onAdd={(a) => setP({ ...p, guardians: [...p.guardians, a] })} />
      {err && <ErrorNote>{err}</ErrorNote>}
      <EditorButtons
        disabled={p.guardians.length < 1}
        onCancel={close}
        onSave={async () => {
          setErr(null);
          const added = p.guardians.filter((g) => !will.guardians.some((x) => x.account_id === g));
          await saveWillPeople(will, p);
          // Test people made here hold their keys in this browser: they accept at once.
          const local = added.filter((g) => keys.secret(g));
          if (local.length) await acceptAsGuardians(will.owner, local, () => {}).catch((e) => setErr(String(e)));
          refresh();
          close();
        }}
      />
      <p className="text-sm text-muted">New guardians count once they accept.</p>
    </div>
  );
}

function LawyerFriendsSection({ will, editable }: { will: Will; editable: boolean }) {
  const label = useAccountLabel();
  return (
    <Section title="Lawyer and friends" editable={editable} editor={(close) => <LawyerFriendsEditor will={will} close={close} />}>
      <ul className="divide-y divide-line">
        {will.lawyer && <PersonRow name={label(will.lawyer)} right={<span className="text-muted">Lawyer</span>} />}
        {will.contacts.map((c) => (
          <PersonRow key={c} name={label(c)} right={<span className="text-muted">Friend</span>} />
        ))}
      </ul>
      {!will.lawyer && !will.contacts.length && <p className="text-muted">None yet. Friends can only stop things; a lawyer can speed up the release, never skip a step.</p>}
    </Section>
  );
}

function LawyerFriendsEditor({ will, close }: { will: Will; close: () => void }) {
  const [p, setP] = useState(() => peopleOf(will));
  const label = useAccountLabel();
  const save = useSave(will, close);
  const taken = [...p.contacts, ...(p.lawyer ? [p.lawyer] : []), ...p.heirs.map((h) => h.account_id)];
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 font-medium">Lawyer</p>
        {p.lawyer ? (
          <ul>
            <PersonRow
              name={label(p.lawyer)}
              right={
                <button type="button" className="min-h-11 px-3 text-muted underline" onClick={() => setP({ ...p, lawyer: null })}>
                  Remove
                </button>
              }
            />
          </ul>
        ) : (
          <AddPerson owner={will.owner} role="lawyer" taken={taken} onAdd={(a) => setP({ ...p, lawyer: a })} />
        )}
      </div>
      <div>
        <p className="mb-2 font-medium">Friends</p>
        <ul className="divide-y divide-line">
          {p.contacts.map((c) => (
            <PersonRow
              key={c}
              name={label(c)}
              right={
                <button type="button" className="min-h-11 px-3 text-muted underline" onClick={() => setP({ ...p, contacts: p.contacts.filter((x) => x !== c) })}>
                  Remove
                </button>
              }
            />
          ))}
        </ul>
        <AddPerson owner={will.owner} role="friend" taken={taken} onAdd={(a) => setP({ ...p, contacts: [...p.contacts, a] })} />
      </div>
      <EditorButtons onSave={() => save(p)} onCancel={close} />
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-muted">Someone without a NEAR account? Invite them by link</summary>
        <InviteByLink owner={will.owner} hasLawyer={!!will.lawyer} will={will} />
      </details>
    </div>
  );
}

function EditorButtons({ onSave, onCancel, disabled }: { onSave: () => Promise<unknown>; onCancel: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ActionButton disabled={disabled} onClick={onSave}>
        Save
      </ActionButton>
      <button type="button" className="min-h-11 px-3 text-muted underline" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
