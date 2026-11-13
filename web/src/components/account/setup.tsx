"use client";
// Account setup after the first sign-in (round 5): username, recovery key, your people, your vault.
// Every step can be skipped; everything set here lives in Profile and can be changed later.
import { useState } from "react";
import { BackupAccess } from "@/components/account/access";
import { nameOf, setName } from "@/lib/names";
import { localProfile, newId, ROLE_LABEL, saveProfile, useProfile, type Role } from "@/lib/profile";
import { ActionButton, Avatar, Card, Field, inputCls } from "../ui";

const STEPS = ["Username", "Recovery key", "Your people", "Your vault"];

export function AccountSetup({ owner, onDone }: { owner: string; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const back = () => setStep(Math.max(0, step - 1));
  const next = async () => {
    if (step < STEPS.length - 1) return setStep(step + 1);
    await saveProfile(owner, { setupDone: true }).catch(() => {});
    onDone();
  };
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-serif text-3xl sm:text-4xl">Set up your account</h1>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" className={`min-h-11 ${i === step ? "font-semibold text-accent" : i < step ? "text-accent" : "text-muted"}`} onClick={() => setStep(i)}>
                {i < step ? "✓" : `${i + 1}.`} {s}
              </button>
            </li>
          ))}
        </ol>
      </div>
      {step === 0 && <UsernameStep owner={owner} />}
      {step === 1 && <BackupAccess owner={owner} />}
      {step === 2 && <PeopleStep owner={owner} />}
      {step === 3 && <VaultStep owner={owner} />}
      <div className="flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button type="button" className="min-h-11 rounded-lg border border-line px-4 py-2 hover:bg-accent-soft" onClick={back}>
            Back
          </button>
        )}
        <ActionButton onClick={next}>{step === STEPS.length - 1 ? "Finish" : "Next"}</ActionButton>
        <button
          type="button"
          className="ml-auto min-h-11 px-3 text-sm text-muted underline"
          onClick={async () => (await saveProfile(owner, { setupDone: true }).catch(() => {}), onDone())}
        >
          Skip setup
        </button>
      </div>
    </div>
  );
}

function UsernameStep({ owner }: { owner: string }) {
  const [name, setDraft] = useState(() => (nameOf(owner) ?? "").replace(/([a-z])([A-Z])/g, "$1 $2"));
  return (
    <Card title="Your username">
      <p className="mb-3 text-muted">We made one up. Change it to what your people call you; it&apos;s used in emails, Telegram and your will.</p>
      <input
        className={`${inputCls} w-full max-w-sm`}
        aria-label="Username"
        maxLength={64}
        value={name}
        onChange={(e) => {
          setDraft(e.target.value);
          // Saved as you type (this browser); an empty box keeps the old name.
          if (e.target.value.trim()) setName(owner, e.target.value.trim());
        }}
      />
    </Card>
  );
}

function PeopleStep({ owner }: { owner: string }) {
  const [profile, save] = useProfile(owner);
  const [name, setName_] = useState("");
  const [role, setRole] = useState<Role>("heir");
  return (
    <Card title="Your people">
      <p className="mb-3 text-muted">Heirs, guardians, friends and a lawyer. A name is enough for now; add details in Profile.</p>
      <ul className="divide-y divide-line">
        {profile.people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <Avatar name={p.name} />
            <span className="flex-1 text-lg">{p.name}</span>
            <span className="text-muted">{ROLE_LABEL[p.role]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Name">
          <input className={inputCls} maxLength={64} value={name} onChange={(e) => setName_(e.target.value)} />
        </Field>
        <Field label="Role">
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <ActionButton tone="quiet" disabled={!name.trim()} onClick={async () => {
            const person = { id: newId(), name: name.trim(), role };
            setName_("");
            await save({ people: [...localProfile(owner).people, person] });
          }}>
          Add
        </ActionButton>
      </div>
    </Card>
  );
}

function VaultStep({ owner }: { owner: string }) {
  const [profile, save] = useProfile(owner);
  const d = (profile.draft ?? {}) as { v?: number; assets?: { ETH: boolean; BTC: boolean } };
  const [name, setName_] = useState(profile.vaultName ?? "");
  const [assets, setAssets] = useState(d.assets ?? { ETH: false, BTC: false });
  const [saved, setSaved] = useState(false);
  return (
    <Card title="Your vault">
      <p className="mb-3 text-muted">One vault holds what your heirs receive. You fund it when you start your will; it stays yours to withdraw from.</p>
      <Field label="Vault name">
        <input className={inputCls} maxLength={64} placeholder="e.g. Family savings" value={name} onChange={(e) => setName_(e.target.value)} />
      </Field>
      <fieldset className="mt-3 flex flex-wrap gap-4">
        <legend className="mb-1 text-sm text-muted">Chains</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked disabled /> NEAR
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={assets.ETH} onChange={(e) => setAssets({ ...assets, ETH: e.target.checked })} /> Ethereum
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={assets.BTC} onChange={(e) => setAssets({ ...assets, BTC: e.target.checked })} /> Bitcoin
        </label>
      </fieldset>
      <div className="mt-3">
        <ActionButton
          tone="quiet"
          onClick={async () => {
            // The chains ride in the draft until the will starts (a full draft keeps its own choice).
            const draft = d.v === 1 ? { ...d, assets } : { v: 0, assets };
            await save({ vaultName: name.trim(), draft });
            setSaved(true);
          }}
        >
          Save
        </ActionButton>
        {saved && <span className="ml-2 text-sm text-accent">Saved.</span>}
      </div>
    </Card>
  );
}
