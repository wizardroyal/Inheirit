"use client";
// Profile: the username, linked accounts, the recovery key, then your people by role (heirs, guardians,
// lawyer, friends), each with + to add and ⚙ to edit. Contact details stay with the agent, never on-chain.
import { useState } from "react";
import { ApproveDevice, BackupAccess } from "@/components/account/access";
import { PeopleBlock } from "@/components/account/profile";
import { useSignalStatus } from "@/components/account/strength";
import { Icon, type IconName } from "@/components/icons";
import { ActionButton, Card, ConfirmButton, ErrorNote, GearButton, inputCls } from "@/components/ui";
import { TelegramLink } from "@/components/TelegramLink";
import { useAccount } from "@/lib/account";
import { agent } from "@/lib/agent";
import { nameOf, setName, useNames } from "@/lib/names";
import { signRequest } from "@/lib/near";

export default function ProfilePage() {
  const { owner, will, setOwner, viewing } = useAccount();
  if (viewing) return <p className="text-muted">The profile is for the account owner.</p>;
  return (
    <div className="space-y-6">
      <Username owner={owner} />
      <LinkedAccounts owner={owner} hasWill={!!will} />
      <BackupAccess owner={owner} />
      <PeopleBlock owner={owner} will={will} role="heir" title="Heirs" />
      <PeopleBlock owner={owner} will={will} role="guardian" title="Guardians" />
      <PeopleBlock owner={owner} will={will} role="lawyer" title="Lawyer" />
      <PeopleBlock owner={owner} will={will} role="friend" title="Friends" />
      <ApproveDevice owner={owner} />
      <div>
        <ActionButton tone="quiet" onClick={async () => setOwner("")}>
          Sign out of this browser
        </ActionButton>
      </div>
    </div>
  );
}

/** The username first, like a profile header: how heirs, guardians and friends see you named. */
export function Username({ owner }: { owner: string }) {
  useNames();
  const current = nameOf(owner) ?? "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft font-serif text-3xl text-accent">{(current || "?").slice(0, 1).toUpperCase()}</span>
      <h1 className="font-serif text-3xl sm:text-4xl">{current || "Your profile"}</h1>
      <GearButton open={open} label="Change your username" onClick={() => (setDraft(current), setOpen(!open))} />
      {open && (
        <span className="flex w-full flex-wrap items-center gap-2">
          <input className={inputCls} aria-label="Username" maxLength={64} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <ActionButton
            disabled={!draft.trim()}
            onClick={async () => {
              setName(owner, draft.trim());
              await agent.registerOwner(await signRequest(owner, "register_owner", { display_name: draft.trim() })).catch(() => {});
              setOpen(false);
            }}
          >
            Save
          </ActionButton>
        </span>
      )}
    </div>
  );
}

const SOON: { icon: IconName; label: string }[] = [
  { icon: "x", label: "X" },
  { icon: "instagram", label: "Instagram" },
  { icon: "tiktok", label: "TikTok" },
  { icon: "mail", label: "Gmail" },
  { icon: "calendar", label: "Google Calendar" },
];

function Row({ icon, label, status, children, muted }: { icon: IconName; label: string; status: string; children?: React.ReactNode; muted?: boolean }) {
  return (
    <li className={`flex min-h-14 flex-wrap items-center gap-3 py-2 ${muted ? "text-muted opacity-70" : ""}`}>
      <Icon name={icon} className="h-6 w-6" />
      <span className="min-w-0 flex-1 text-lg">{label}</span>
      <span className={`text-sm ${status === "connected" ? "text-accent" : "text-muted"}`}>{status}</span>
      {children}
    </li>
  );
}

/** Telegram and GitHub connect for real; email is where alerts go; the rest are coming soon. */
function LinkedAccounts({ owner, hasWill }: { owner: string; hasWill: boolean }) {
  const { connected, watching } = useSignalStatus(owner);
  const [open, setOpen] = useState<"telegram" | "github" | "email" | null>(null);
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const send = (data: Record<string, unknown>) => signRequest(owner, "register_owner", data).then((s) => agent.registerOwner(s));
  const run = (f: () => Promise<unknown>) => async () => {
    setErr(null);
    try {
      await f();
      setOpen(null);
      setValue("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const connectBtn = (k: "github" | "email" | "telegram") => (
    <button type="button" className="min-h-11 rounded-lg border border-line px-4 py-1 hover:bg-accent-soft" onClick={() => (setOpen(open === k ? null : k), setValue(""))}>
      Connect
    </button>
  );
  const field = (placeholder: string, save: () => Promise<unknown>) => (
    <li className="flex flex-wrap gap-2 pb-3">
      <input className={`${inputCls} min-w-0 flex-1`} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value.trim())} autoFocus />
      <ActionButton disabled={!value} onClick={run(save)}>
        Save
      </ActionButton>
    </li>
  );
  return (
    <Card title="Linked accounts">
      <ul className="divide-y divide-line">
        <Row icon="telegram" label="Telegram" status={connected.telegram ? "connected" : "not connected"}>
          {connected.telegram ? (
            <ConfirmButton label="Disconnect" question="Unlink Telegram?" onConfirm={() => signRequest(owner, "telegram_link", {}).then((s) => agent.telegramUnlink(s))} />
          ) : (
            connectBtn("telegram")
          )}
        </Row>
        {open === "telegram" && (
          <li className="pb-3">
            <TelegramLink account={owner} />
          </li>
        )}
        <Row icon="github" label="GitHub" status={connected.github ? "connected" : "not connected"}>
          {connected.github ? <ConfirmButton label="Disconnect" question="Stop watching GitHub?" onConfirm={() => send({ github: "" })} /> : hasWill && connectBtn("github")}
        </Row>
        {open === "github" && field("GitHub username", () => send({ github: value }))}
        <Row icon="mail" label="Email alerts" status={watching.email ? "connected" : "not connected"}>
          {watching.email ? <ConfirmButton label="Disconnect" question="Stop email alerts?" onConfirm={() => send({ email: "" })} /> : hasWill && connectBtn("email")}
        </Row>
        {open === "email" && field("you@example.com", () => send({ email: value }))}
        {SOON.map((s) => (
          <Row key={s.label} icon={s.icon} label={s.label} status="coming soon" muted />
        ))}
      </ul>
      {!hasWill && <p className="mt-2 text-sm text-muted">GitHub and email connect once your will is started.</p>}
      {err && <ErrorNote>{err}</ErrorNote>}
    </Card>
  );
}

