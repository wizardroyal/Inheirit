"use client";
// Heartbeat app (installable PWA): opening it sends a signed ping; the big button sends another.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { agent } from "@/lib/agent";
import { useMyAccounts } from "@/lib/hooks";
import { accountLabel, useNames } from "@/lib/names";
import { keys } from "@/lib/keys";
import { errorText, signRequest, view } from "@/lib/near";
import { ago } from "@/lib/will";
import { Details } from "@/components/ui";

const LAST = "inheirit:heartbeat-owner";
const SENT = "inheirit:heartbeat-at";

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the heartbeat itself still works
  }
}

export default function HeartbeatPage() {
  const mine = useMyAccounts();
  const names = useNames();
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastAt, setLastAt] = useState("");
  const [busy, setBusy] = useState(false);
  const autoSent = useRef(false);

  const ping = async (who: string) => {
    setBusy(true);
    try {
      const r = await agent.heartbeat(await signRequest(who, "heartbeat"));
      write(SENT, r.at);
      setLastAt(r.at);
      setStatus({ ok: true, text: "Got it. Your will knows you're here." });
    } catch (e) {
      const msg = errorText(e);
      setStatus({
        ok: false,
        text: /^No will for /.test(msg) ? "No will yet. Create one on Your will first." : msg,
      });
    } finally {
      setBusy(false);
    }
  };

  // Opening the app is the heartbeat: send one for the account used last time on this device.
  useEffect(() => {
    const last = read(LAST);
    setLastAt(read(SENT));
    if (last) setOwner(last);
    // Only for an account whose key is here (a wallet would pop up unasked) and that has a will.
    if (last && !autoSent.current && keys.secret(last)) {
      autoSent.current = true;
      view("get_will", { owner: last })
        .then((w) => w && ping(last))
        .catch(() => {});
    }
  }, []);

  // No choice made on this device yet: use the most recent sign-in.
  useEffect(() => {
    if (!owner && mine.length) {
      setOwner(mine[mine.length - 1]);
      write(LAST, mine[mine.length - 1]);
    }
  }, [owner, mine]);

  if (mine.length === 0 && !owner) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-10 text-center">
        <h1 className="font-serif text-4xl sm:text-5xl">Heartbeat</h1>
        <p className="text-lg text-muted">Sign in. Then opening this page counts as a sign of life.</p>
        <Link href="/account" className="rounded-lg bg-accent px-6 py-3 font-medium text-accent-ink hover:opacity-90">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-6 text-center">
      <h1 className="font-serif text-4xl sm:text-5xl">Heartbeat</h1>
      <p className="text-lg text-muted">Opening this page is enough.</p>
      {mine.length > 1 ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">For</span>
          <select
            className="rounded-lg border border-line bg-card px-3 py-1.5"
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              write(LAST, e.target.value);
            }}
          >
            {mine.map((a) => (
              <option key={a} value={a}>
                {accountLabel(a, names)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        owner && (
          <p className="text-sm text-muted">
            Signed in as <span className="font-medium text-ink">{accountLabel(owner, names)}</span>
          </p>
        )
      )}
      <button
        type="button"
        disabled={!owner || busy}
        onClick={() => ping(owner)}
        className="h-52 w-52 rounded-full bg-accent font-serif text-3xl text-accent-ink shadow-lg hover:opacity-95 disabled:opacity-40"
      >
        {busy ? "Sending…" : "I'm here"}
      </button>
      <div className="min-h-12 space-y-1">
        {status && <p className={status.ok ? "font-medium text-accent" : "text-danger"}>{status.text}</p>}
        {lastAt && <p className="text-sm text-muted">Last heartbeat {ago(lastAt)}</p>}
      </div>
      <p className="text-sm text-muted">Add it to your home screen. It&apos;s the strongest sign of life.</p>
      <Details summary="How it works">
        <div>Signed with a key on your NEAR account (NEP-413).</div>
        <div>The agent checks the key on-chain and records only the time.</div>
      </Details>
    </div>
  );
}
