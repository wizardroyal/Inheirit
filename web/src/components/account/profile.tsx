"use client";
// Profile (round 5): the owner's people, each a row with ⚙ to edit inline. Contact details are saved with
// the agent (owner-signed) and never put on-chain. Someone used in the will can't be deleted here.
import { useState } from "react";
import { createPerson } from "@/lib/onboard";
import { missingFromProfile, newId, ROLE_LABEL, roleOnWill, useProfile, type Person, type Role } from "@/lib/profile";
import { nameAccounts } from "@/lib/names";
import type { Will } from "@/lib/will";
import { ActionButton, Avatar, Card, ConfirmButton, ErrorNote, Field, GearButton, inputCls, Pill } from "../ui";

const ROLES: Role[] = ["heir", "guardian", "friend", "lawyer"];

/** Status on the will: accepted / invited for guardians, "on your will" for the rest, else "not on your will". */
function status(will: Will | null, p: Person): { text: string; tone: "accent" | "warn" | "neutral" } {
  const role = roleOnWill(will, p.account);
  if (!role) return { text: will ? "not on your will" : "saved", tone: "neutral" };
  if (role === "guardian") {
    const g = will!.guardians.find((x) => x.account_id === p.account)!;
    return g.accepted ? { text: "accepted", tone: "accent" } : { text: "invited", tone: "warn" };
  }
  return { text: "on your will", tone: "accent" };
}

export function PeopleList({ owner, will }: { owner: string; will: Will | null }) {
  const [profile, save] = useProfile(owner);
  // Everyone on the will shows here, even if they were added before profiles existed.
  const people = [...profile.people, ...missingFromProfile(will, profile)];
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const write = (next: Person[]) => save({ people: next });
  return (
    <Card title="Your people">
      {people.length === 0 && <p className="text-muted">Nobody yet. Add your heirs, guardians, friends and a lawyer; a name is enough.</p>}
      <ul className="divide-y divide-line">
        {people.map((p) => (
          <li key={p.id} className="py-3">
            <div className="flex items-center gap-3">
              <Avatar name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg">{p.name}</span>
                <span className="text-sm text-muted">{ROLE_LABEL[p.role]}</span>
              </span>
              <Pill tone={status(will, p).tone}>{status(will, p).text}</Pill>
              <GearButton open={open === p.id} label={`Edit ${p.name}`} onClick={() => setOpen(open === p.id ? null : p.id)} />
            </div>
            {open === p.id && (
              <PersonForm
                person={p}
                lockedRole={roleOnWill(will, p.account)}
                onSave={async (np) => {
                  const rest = people.filter((x) => x.id !== p.id);
                  await write([...rest, np]);
                  if (np.account) nameAccounts({ [np.account]: np.name });
                  setOpen(null);
                }}
                onDelete={
                  roleOnWill(will, p.account)
                    ? null
                    : async () => {
                        await write(people.filter((x) => x.id !== p.id));
                        setOpen(null);
                      }
                }
              />
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <PersonForm
          owner={owner}
          person={{ id: newId(), name: "", role: "heir" }}
          lockedRole={null}
          onSave={async (np) => {
            await write([...people, np]);
            if (np.account) nameAccounts({ [np.account]: np.name });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
          onDelete={null}
        />
      ) : (
        <button type="button" className="mt-3 min-h-11 rounded-lg border border-line px-4 py-2 hover:bg-accent-soft" onClick={() => setAdding(true)}>
          + Add a person
        </button>
      )}
    </Card>
  );
}

/** Inline edit: name, role, email, Telegram, wallets. Only the name is required. */
export function PersonForm({
  person,
  lockedRole,
  onSave,
  onDelete,
  onCancel,
  owner,
}: {
  person: Person;
  /** Their role on the will, if any: it's changed on My will, not here. */
  lockedRole: Role | null;
  onSave: (p: Person) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
  onCancel?: () => void;
  /** Given when adding: offers "make a test person" for the NEAR account. */
  owner?: string;
}) {
  const [p, setP] = useState<Person>(person);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Person) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP({ ...p, [k]: e.target.value });
  const check = (): string | null => {
    if (!p.name.trim()) return "Give them a name.";
    if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return "That email doesn't look right.";
    if (p.eth && !/^0x[0-9a-fA-F]{40}$/.test(p.eth)) return "An Ethereum address starts with 0x and has 40 more characters.";
    if (p.account && !/^[a-z0-9._-]{2,64}$/.test(p.account)) return "A NEAR account looks like ada.testnet.";
    return null;
  };
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-bg p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={inputCls} maxLength={64} value={p.name} onChange={set("name")} autoFocus={!person.name} />
        </Field>
        <Field label="Role" hint={lockedRole ? "Change their role on My will." : undefined}>
          <select className={inputCls} value={p.role} disabled={!!lockedRole} onChange={set("role")}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Email (optional)">
          <input className={inputCls} type="email" value={p.email ?? ""} onChange={set("email")} />
        </Field>
        <Field label="Telegram (optional)">
          <input className={inputCls} placeholder="@handle" value={p.telegram ?? ""} onChange={set("telegram")} />
        </Field>
        {!lockedRole && (
        <Field label="NEAR account (optional)" hint="They can also join by an invite link.">
          <span className="flex gap-2">
            <input className={`${inputCls} min-w-0 flex-1`} value={p.account ?? ""} onChange={set("account")} />
            {owner && !p.account && (
              <ActionButton tone="quiet" onClick={async () => setP({ ...p, account: (await createPerson(owner, p.name.trim() || undefined)).accountId })}>
                Test person
              </ActionButton>
            )}
          </span>
        </Field>
        )}
        <Field label="Ethereum wallet (optional)">
          <input className={inputCls} placeholder="0x…" value={p.eth ?? ""} onChange={set("eth")} />
        </Field>
        <Field label="Bitcoin wallet (optional)">
          <input className={inputCls} placeholder="tb1…" value={p.btc ?? ""} onChange={set("btc")} />
        </Field>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          onClick={async () => {
            const e = check();
            setErr(e);
            if (!e) await onSave({ ...p, name: p.name.trim() });
          }}
        >
          Save
        </ActionButton>
        {onCancel && (
          <button type="button" className="min-h-11 px-3 text-muted underline" onClick={onCancel}>
            Cancel
          </button>
        )}
        {onDelete ? (
          <ConfirmButton label="Delete" question={`Delete ${person.name}?`} onConfirm={onDelete} />
        ) : (
          lockedRole && <span className="text-sm text-muted">Used in your will. Remove them there first to delete.</span>
        )}
      </div>
    </div>
  );
}
