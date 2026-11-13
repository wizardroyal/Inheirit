"use client";
// Access recovery: back up the key this browser holds, restore it elsewhere, or approve a new device.
// Keys stay on the owner's devices; nothing here is sent to us.
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { useEffect, useState } from "react";
import { keys } from "@/lib/keys";
import { account, provider } from "@/lib/near";
import { backupFile, pairingCode, parseBackup, parsePairing, recoveryLine } from "@/lib/recovery";
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

/** Sign-in on a new device: make a key here and show a code for a device already signed in to approve. */
export function NewDevice({ onApproved }: { onApproved: (account: string) => void }) {
  const [acc, setAcc] = useState("");
  const [pending, setPending] = useState<{ account: string; secret: string; code: string } | null>(null);
  useEffect(() => {
    if (!pending) return;
    const pub = KeyPair.fromString(pending.secret as KeyPairString).getPublicKey().toString();
    const t = setInterval(async () => {
      const ok = await provider.viewAccessKey(pending.account, pub).then(() => true, () => false);
      if (ok) {
        clearInterval(t);
        keys.addAccount(pending.account, pending.secret);
        onApproved(pending.account);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [pending, onApproved]);
  return (
    <details className="rounded-2xl border border-line bg-card p-5">
      <summary className="cursor-pointer text-lg">Use an account from another device</summary>
      {!pending ? (
        <div className="mt-3 space-y-3">
          <Field label="Your account (shown in Settings on the other device)">
            <input className={inputCls} value={acc} onChange={(e) => setAcc(e.target.value.trim())} placeholder="demo-1a2b3c4d.inheirit-users.testnet" />
          </Field>
          <ActionButton
            disabled={!acc}
            onClick={async () => {
              const kp = KeyPair.fromRandom("ed25519");
              setPending({ account: acc, secret: kp.toString(), code: pairingCode(acc, kp.getPublicKey().toString()) });
            }}
          >
            Get a device code
          </ActionButton>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p>On the device you already use: Settings → Add another device → paste this code.</p>
          <p className="break-all rounded-lg border border-line bg-bg p-3 font-mono text-sm">{pending.code}</p>
          <ActionButton tone="quiet" onClick={() => navigator.clipboard.writeText(pending.code)}>
            Copy code
          </ActionButton>
          <p className="text-muted">Waiting for approval…</p>
        </div>
      )}
    </details>
  );
}

/** Settings: approve a new device's code (adds its key to this account; only this account's own key can). */
export function ApproveDevice({ owner }: { owner: string }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!keys.secret(owner)) return null;
  return (
    <Card title="Add another device">
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        <li>On the new device, open inheirit.xyz and choose <b className="text-ink">Use an account from another device</b> on the sign-in screen.</li>
        <li>It shows a pairing code. Paste it below and approve.</li>
      </ol>
      <p className="mt-2 text-sm text-muted">The code is made on the new device, so its key never leaves it. Or sign in there with your recovery key.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Device code">
          <input className={inputCls} value={code} onChange={(e) => (setCode(e.target.value), setMsg(null))} placeholder="inheirit-pair:v1:…" />
        </Field>
        <ActionButton
          disabled={!code.trim()}
          onClick={async () => {
            try {
              const p = parsePairing(code);
              if (p.account !== owner) throw new Error("That code is for a different account.");
              await account(owner).addFullAccessKey(p.publicKey);
              setMsg({ ok: true, text: "Approved. The new device is signing in." });
              setCode("");
            } catch (e) {
              setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
            }
          }}
        >
          Approve device
        </ActionButton>
      </div>
      {msg && <p className={`mt-2 ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
    </Card>
  );
}
