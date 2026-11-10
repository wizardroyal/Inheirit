"use client";
// Sign-in (CLAUDE.md §13A.1): a NEAR testnet wallet, Google (an app-created testnet account whose key
// stays in this browser), or a demo account with no sign-in at all.
import { useEffect, useRef, useState } from "react";
import { createDemoAccount, onboardInfo, restoreKeyBackup, signInWithGoogle, type OnboardInfo } from "@/lib/onboard";
import { connectWallet } from "@/lib/wallet";
import { ActionButton, Card, ErrorNote } from "./ui";

interface GoogleId {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void;
      renderButton(el: HTMLElement, o: Record<string, unknown>): void;
    };
  };
}

function loadGoogleScript(): Promise<GoogleId> {
  const w = window as unknown as { google?: GoogleId };
  if (w.google?.accounts) return Promise.resolve(w.google);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error("Google sign-in didn't load")));
    s.onerror = () => reject(new Error("Google sign-in didn't load (blocked by the browser?)"));
    document.head.appendChild(s);
  });
}

function GoogleButton({ clientId, onAccount, onError }: { clientId: string; onAccount: (id: string) => void; onError: (e: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  // Latest callbacks without re-initialising Google's button on every render
  const cb = useRef({ onAccount, onError });
  cb.current = { onAccount, onError };
  useEffect(() => {
    let live = true;
    loadGoogleScript()
      .then((g) => {
        if (!live || !el.current) return;
        g.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            setBusy(true);
            signInWithGoogle(credential)
              .then(cb.current.onAccount, (e) => cb.current.onError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          },
        });
        g.accounts.id.renderButton(el.current, { theme: "outline", size: "large", text: "continue_with", shape: "pill" });
      })
      .catch((e) => cb.current.onError(e.message));
    return () => {
      live = false;
    };
  }, [clientId]);
  return (
    <div>
      <div ref={el} />
      {busy && <p className="mt-1 text-xs text-muted">Creating your testnet account (about 5 s)…</p>}
    </div>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn: (accountId: string) => void }) {
  const [info, setInfo] = useState<OnboardInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    onboardInfo().then(setInfo, () => setInfo({ enabled: false, parent: null, googleClientId: null }));
  }, []);
  return (
    <Card title="Sign in">
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-2">
          <p className="font-medium">NEAR wallet</p>
          <p className="text-xs text-muted">MyNearWallet, Meteor or Intear, on testnet. Every action is confirmed in your wallet.</p>
          <ActionButton onClick={async () => onSignedIn(await connectWallet())}>Connect a wallet</ActionButton>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Google</p>
          <p className="text-xs text-muted">
            We create a free testnet account for you. Its key is made and kept in this browser; download a backup afterwards. Your email never goes
            on-chain.
          </p>
          {info?.enabled && info.googleClientId ? (
            <GoogleButton clientId={info.googleClientId} onAccount={onSignedIn} onError={setError} />
          ) : (
            <p className="text-xs text-muted">{info ? "Not available on this deployment." : "…"}</p>
          )}
        </div>
        <div className="space-y-2">
          <p className="font-medium">No sign-in</p>
          <p className="text-xs text-muted">A fresh, funded testnet account in this browser. Good for trying everything in a few minutes.</p>
          <ActionButton tone="quiet" disabled={info !== null && !info.enabled} onClick={async () => onSignedIn(await createDemoAccount())}>
            Try with a demo account
          </ActionButton>
        </div>
      </div>
      <label className="mt-4 block text-xs text-muted">
        Have a key backup from another browser?{" "}
        <input
          type="file"
          accept="application/json"
          className="text-xs"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) restoreKeyBackup(f).then(onSignedIn, (err) => setError(err instanceof Error ? err.message : String(err)));
          }}
        />
      </label>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Testnet only. No real money is involved anywhere in this app.</p>
    </Card>
  );
}
