"use client";
// Heartbeat app (installable PWA): opening it sends a signed ping; the big button sends another.
import { useEffect, useRef, useState } from "react";
import { ActAs } from "@/components/ActAs";
import { agent } from "@/lib/agent";
import { useKeys } from "@/lib/hooks";
import { errorText, signRequest } from "@/lib/near";

const LAST = "inheirit:heartbeat-owner";

export default function HeartbeatPage() {
  const { casts } = useKeys();
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const autoSent = useRef(false);

  const ping = async (who: string) => {
    setBusy(true);
    try {
      const r = await agent.heartbeat(await signRequest(who, "heartbeat"));
      setStatus({ ok: true, text: `Got it, thanks. Recorded at ${new Date(r.at).toLocaleTimeString()}.` });
    } catch (e) {
      setStatus({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  // Passive ping on open, for the owner used last time on this device
  useEffect(() => {
    let last = "";
    try {
      last = window.localStorage.getItem(LAST) ?? "";
    } catch {}
    if (last) setOwner(last);
    if (last && !autoSent.current) {
      autoSent.current = true;
      ping(last);
    }
  }, []);

  const choose = (id: string) => {
    setOwner(id);
    try {
      window.localStorage.setItem(LAST, id);
    } catch {}
  };

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-6 text-center">
      <h1 className="font-serif text-4xl sm:text-5xl">Heartbeat</h1>
      <p className="text-muted">Just opening this app is enough: it tells your will&apos;s agent you&apos;re here, signed with your key.</p>
      <ActAs value={owner} onChange={choose} suggested={casts.map((c) => c.owner)} label="Your account" />
      <button
        type="button"
        disabled={!owner || busy}
        onClick={() => ping(owner)}
        className="h-48 w-48 rounded-full border-4 border-line bg-accent font-serif text-3xl text-accent-ink transition hover:scale-[1.02] disabled:opacity-40"
      >
        {busy ? "…" : "I'm here"}
      </button>
      {status && <p className={status.ok ? "text-accent" : "text-danger"}>{status.text}</p>}
      <p className="text-xs text-muted">
        A heartbeat is a strong sign of life: it&apos;s signed with a key on your NEAR account (NEP-413), and the agent checks that key on-chain. Add
        this page to your home screen to install it.
      </p>
    </div>
  );
}
