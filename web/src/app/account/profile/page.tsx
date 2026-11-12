"use client";
// Profile (round 5): your people, your vault, your account. Everything set during setup lives here.
import { useState } from "react";
import { ApproveDevice, BackupAccess } from "@/components/account/access";
import { EmailAlerts } from "@/components/account/parts";
import { PeopleList } from "@/components/account/profile";
import { VaultName, VaultSection } from "@/components/account/vault";
import { TelegramLink } from "@/components/TelegramLink";
import { ActionButton, Card, Field, inputCls } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { agent } from "@/lib/agent";
import { nameOf, setName } from "@/lib/names";
import { signRequest } from "@/lib/near";

export default function ProfilePage() {
  const { owner, will, setOwner, viewing } = useAccount();
  if (viewing) return <p className="text-muted">The profile is for the account owner.</p>;
  return (
    <div className="space-y-8">
      <h1 className="font-serif text-3xl sm:text-4xl">Profile</h1>
      <PeopleList owner={owner} will={will} />
      <section className="space-y-4">
        {will ? <VaultSection will={will} withFunding={false} /> : (
          <Card>
            <VaultName owner={owner} />
            <p className="mt-2 text-muted">Your vault opens when you start your will.</p>
          </Card>
        )}
      </section>
      <section className="space-y-6">
        <h2 className="font-serif text-2xl">Account</h2>
        <Username owner={owner} />
        <BackupAccess owner={owner} />
        {will && <EmailAlerts will={will} />}
        <Card title="Telegram">
          <TelegramLink account={owner} purpose="Checks reach you there first, and any reply counts as a sign of life." />
        </Card>
        <ApproveDevice owner={owner} />
        <Card title="Sign out">
          <ActionButton tone="quiet" onClick={async () => setOwner("")}>
            Sign out of this browser
          </ActionButton>
        </Card>
      </section>
    </div>
  );
}

/** The username: how heirs, guardians and friends see you named (emails, Telegram, the will's text). */
export function Username({ owner }: { owner: string }) {
  const [name, setDraft] = useState(() => nameOf(owner) ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <Card title="Username">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="How your people see you named">
          <input className={inputCls} maxLength={64} value={name} onChange={(e) => (setDraft(e.target.value), setSaved(false))} />
        </Field>
        <ActionButton
          tone="quiet"
          disabled={!name.trim()}
          onClick={async () => {
            setName(owner, name.trim());
            await agent.registerOwner(await signRequest(owner, "register_owner", { display_name: name.trim() })).catch(() => {});
            setSaved(true);
          }}
        >
          Save
        </ActionButton>
        {saved && <span className="text-sm text-accent">Saved.</span>}
      </div>
    </Card>
  );
}
