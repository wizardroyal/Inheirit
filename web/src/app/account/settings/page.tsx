"use client";
// Settings: display name, email and Telegram alerts, quiet period, sign out.
import { useState } from "react";
import { EmailAlerts } from "@/components/account/parts";
import { ApproveDevice, BackupAccess } from "@/components/account/access";
import { WillGate } from "@/components/account/home";
import { QuietSetting } from "@/components/account/will";
import { TelegramLink } from "@/components/TelegramLink";
import { ActionButton, Card, Field, inputCls } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { nameOf, setName } from "@/lib/names";

export default function SettingsPage() {
  const { owner, setOwner, viewing } = useAccount();
  const [name, setNameDraft] = useState(() => nameOf(owner) ?? "");
  const [saved, setSaved] = useState(false);
  if (viewing) return <p className="text-muted">Settings are for the account owner.</p>;
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl sm:text-4xl">Settings</h1>
      <Card title="Your name">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Shown to you in this browser">
            <input className={inputCls} maxLength={64} value={name} onChange={(e) => (setNameDraft(e.target.value), setSaved(false))} />
          </Field>
          <ActionButton tone="quiet" onClick={async () => (setName(owner, name.trim()), setSaved(true))}>
            Save
          </ActionButton>
          {saved && <span className="text-sm text-accent">Saved.</span>}
        </div>
      </Card>
      <BackupAccess owner={owner} />
      <ApproveDevice owner={owner} />
      <p className="text-sm text-muted">Your account ID (to add a device): <span className="break-all">{owner}</span></p>
      <WillGate>
        {(will) => (
          <>
            <EmailAlerts will={will} />
            <Card title="Telegram">
              <TelegramLink account={owner} purpose="Checks reach you there first, and any reply counts as a sign of life." />
            </Card>
            <QuietSetting will={will} />
          </>
        )}
      </WillGate>
      <Card title="Sign out">
        <ActionButton tone="quiet" onClick={async () => setOwner("")}>
          Sign out of this browser
        </ActionButton>
      </Card>
    </div>
  );
}
