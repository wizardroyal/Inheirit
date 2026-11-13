"use client";
// Access recovery: back up the key this browser holds and restore it elsewhere.
// Keys stay on the owner's devices; nothing here is sent to us.
import { useState } from "react";
import { keys } from "@/lib/keys";
import { backupFile, parseBackup, recoveryLine } from "@/lib/recovery";
import { ActionButton, Card, ErrorNote, Field, inputCls } from "../ui";

const FLAG = "inheirit:backed-up:";
export const isBackedUp = (owner: string) => {
  try {
    return !keys.secret(owner) || localStorage.getItem(FLAG + owner) === "1";
  } catch {
    return false;
  }
};
const markBackedUp = (owner: string) => {
  try {
    localStorage.setItem(FLAG + owner, "1");
  } catch {
    // storage blocked
  }
};

/** Settings (and setup): the recovery key, shown on request, and the backup file. */
export function BackupAccess({ owner }: { owner: string }) {
  const secret = keys.secret(owner);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(() => isBackedUp(owner));
  if (!secret) return <Card title="Recovery key"><p className="text-muted">Your wallet holds this account&apos;s keys; back it up there.</p></Card>;
  const b = { account: owner, key: secret };
  return (
    <Card title="Recovery key">
      <p>Your key lives only in this browser. This is your spare key if you lose it.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <ActionButton
          onClick={async () => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([backupFile(b)], { type: "application/json" }));
            a.download = "inheirit-recovery.json";
            a.click();
            markBackedUp(owner);
            setDone(true);
          }}
        >
          Download backup file
        </ActionButton>
        <ActionButton tone="quiet" onClick={async () => setShown((v) => !v)}>
          {shown ? "Hide recovery key" : "Show recovery key"}
        </ActionButton>
      </div>
      {shown && (
        <div className="mt-4 space-y-2">
          <p className="break-all rounded-lg border border-line bg-bg p-3 font-mono text-sm">{recoveryLine(b)}</p>
          <ActionButton tone="quiet" onClick={async () => (await navigator.clipboard.writeText(recoveryLine(b)), markBackedUp(owner), setDone(true))}>
            Copy and mark as saved
          </ActionButton>
        </div>
      )}
      {done && <p className="mt-3 text-accent">Backed up on this device ✓</p>}
    </Card>
  );
}

/** Sign-in: restore from a backup file or recovery key. */
export function RestoreAccess({ onRestored }: { onRestored: (account: string) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const restore = (input: string) => {
    try {
      const b = parseBackup(input);
      keys.addAccount(b.account, b.key);
      markBackedUp(b.account);
      onRestored(b.account);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <details className="rounded-2xl border border-line bg-card p-5">
      <summary className="cursor-pointer text-lg">Restore from backup</summary>
      <div className="mt-3 space-y-3">
        <Field label="Recovery key">
          <input className={inputCls} value={text} onChange={(e) => (setText(e.target.value), setError(null))} placeholder="inheirit-recovery:v1:…" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton disabled={!text.trim()} onClick={async () => restore(text)}>
            Restore
          </ActionButton>
          <label className="cursor-pointer text-accent underline">
            or choose the backup file
            <input type="file" accept=".json,application/json" className="sr-only" onChange={async (e) => e.target.files?.[0] && restore(await e.target.files[0].text())} />
          </label>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </details>
  );
}

