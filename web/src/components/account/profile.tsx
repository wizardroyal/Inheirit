"use client";
// Profile people, one block per role: each row shows what matters for that role (an heir's wallet, a
// guardian's status with the invite to copy), and ⚙ edits it inline. Contact is free text the agent reads
// (an email in it is where messages go). Saved with the agent, owner-signed, never on-chain. Someone used in
// the will can't be deleted here.
import { useState } from "react";
import { SITE_URL } from "@/lib/config";
import { useOpenInvites } from "@/lib/invites";
import { nameAccounts } from "@/lib/names";
import { missingFromProfile, newId, roleOnWill, useProfile, type Person, type Role } from "@/lib/profile";
import { newTestReceive } from "@/lib/test-wallets";
import type { Will } from "@/lib/will";
import { Icon } from "../icons";
import { ActionButton, Avatar, Card, ConfirmButton, ErrorNote, Field, GearButton, inputCls, Pill, short } from "../ui";

const ADD_LABEL: Record<Role, string> = { heir: "Add heir", guardian: "Add guardian", lawyer: "Add lawyer", friend: "Add friend" };

function CopyInvite({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-1 text-sm hover:bg-accent-soft" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}>
      <Icon name="copy" className="h-4 w-4" />
      {done ? "Copied" : "Copy invite"}
    </button>
  );
}

export function PeopleBlock({ owner, will, role, title }: { owner: string; will: Will | null; role: Role; title: string }) {
  const [profile, save] = useProfile(owner);
  const [invites] = useOpenInvites(owner);
  const all = [...profile.people, ...missingFromProfile(will, profile)];
  const people = all.filter((p) => p.role === role);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const write = (next: Person[]) => save({ people: next });
  const status = (p: Person) => {
    if (role !== "guardian") return null;
    const g = will?.guardians.find((x) => x.account_id === p.account);
    if (g) return g.accepted ? <Pill tone="accent">accepted</Pill> : (<><Pill tone="warn">invited</Pill><CopyInvite text={`${SITE_URL}/guardian/${owner}`} /></>);
    const inv = invites.find((i) => i.role === "guardian" && i.name === p.name);
    if (inv) return (<><Pill tone="warn">invited</Pill>{inv.link && <CopyInvite text={inv.link} />}</>);
    return <span className="text-sm text-muted">not on your will</span>;
  };
  const detail = (p: Person) =>
    [role === "heir" && p.eth ? `ETH ${short(p.eth, 6)}` : "", role === "heir" && p.btc ? `BTC ${short(p.btc, 6)}` : "", p.contact ?? p.email ?? p.telegram ?? ""].filter(Boolean).join(" · ");
  return (
    <Card title={title}>
      {people.length === 0 && !adding && <p className="text-muted">Nobody yet.</p>}
      <ul className="divide-y divide-line">
        {people.map((p) => (
          <li key={p.id} className="py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg">{p.name}</span>
                {detail(p) && <span className="block truncate text-sm text-muted">{detail(p)}</span>}
              </span>
              {status(p)}
              <GearButton open={open === p.id} label={`Edit ${p.name}`} onClick={() => setOpen(open === p.id ? null : p.id)} />
            </div>
            {open === p.id && (
              <PersonForm
                person={p}
                onSave={async (np) => {
                  await write([...all.filter((x) => x.id !== p.id), np]);
                  if (np.account) nameAccounts({ [np.account]: np.name });
                  setOpen(null);
                }}
                onCancel={() => setOpen(null)}
                onDelete={roleOnWill(will, p.account) ? null : async () => (await write(all.filter((x) => x.id !== p.id)), setOpen(null))}
              />
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <PersonForm
          person={{ id: newId(), name: "", role }}
          onSave={async (np) => (await write([...all, np]), setAdding(false))}
          onCancel={() => setAdding(false)}
          onDelete={null}
        />
      ) : (
        !(role === "lawyer" && people.length > 0) && (
          <button type="button" className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-line px-4 py-2 hover:bg-accent-soft" onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-4 w-4" /> {ADD_LABEL[role]}
          </button>
        )
      )}
    </Card>
  );
}

/** Inline edit: name, wallets (heirs, with ↻ for a test wallet) and contact. Only the name is required. */
export function PersonForm({ person, onSave, onDelete, onCancel }: { person: Person; onSave: (p: Person) => Promise<void>; onDelete: (() => Promise<void>) | null; onCancel: () => void }) {
  const [p, setP] = useState<Person>({ ...person, contact: person.contact ?? [person.email, person.telegram].filter(Boolean).join(", ") });
  const [err, setErr] = useState<string | null>(null);
  const heir = p.role === "heir";
  const wallet = (k: "eth" | "btc", label: string) => (
    <Field label={label}>
      <span className="flex gap-2">
        <input className={`${inputCls} min-w-0 flex-1`} value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value.trim() })} />
        <button
          type="button"
          title="Make a test wallet"
          aria-label={`Make a test ${label.toLowerCase()}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line hover:bg-accent-soft"
          onClick={() => setP({ ...p, [k]: newTestReceive()[k] })}
        >
          <Icon name="refresh" className="h-4 w-4" />
        </button>
      </span>
    </Field>
  );
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-bg p-4">
      <Field label="Name">
        <input className={inputCls} maxLength={64} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} autoFocus={!person.name} />
      </Field>
      {heir && (
        <div className="grid gap-3 sm:grid-cols-2">
          {wallet("eth", "Ethereum wallet")}
          {wallet("btc", "Bitcoin wallet")}
        </div>
      )}
      <Field label="Contact">
        <textarea className={`${inputCls} h-20 w-full`} maxLength={500} placeholder="Email, phone, Telegram: anything that helps reach them" value={p.contact ?? ""} onChange={(e) => setP({ ...p, contact: e.target.value })} />
      </Field>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          onClick={async () => {
            setErr(null);
            if (!p.name.trim()) return setErr("Give them a name.");
            if (p.eth && !/^0x[0-9a-fA-F]{40}$/.test(p.eth)) return setErr("An Ethereum wallet starts with 0x and has 40 more characters.");
            if (p.btc && !/^(tb1|bc1|[mn2])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(p.btc)) return setErr("That Bitcoin wallet doesn't look right.");
            // The email the agent writes to comes from the contact text (lib/profile clean).
            await onSave({ ...p, name: p.name.trim(), email: undefined, telegram: undefined });
          }}
        >
          Save
        </ActionButton>
        <button type="button" className="min-h-11 px-3 text-muted underline" onClick={onCancel}>
          Cancel
        </button>
        {onDelete ? <ConfirmButton label="Delete" question={`Delete ${person.name || "them"}?`} onConfirm={onDelete} /> : person.name && <span className="text-sm text-muted">Used in your will.</span>}
      </div>
    </div>
  );
}
