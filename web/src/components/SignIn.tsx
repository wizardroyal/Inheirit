"use client";
// Sign-in (CLAUDE.md §13A.1): a NEAR testnet wallet, Google (an app-created testnet account whose key
// stays in this browser), or a demo account with no sign-in at all.
import { useEffect, useRef, useState } from "react";
import { createDemoAccount, googleKey, onboardInfo, signInWithGoogle, type OnboardInfo } from "@/lib/onboard";
import { ensureName, rememberOwner } from "@/lib/names";
import { connectWallet } from "@/lib/wallet";
import { ActionButton, Card, ErrorNote } from "./ui";

interface GoogleId {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential: string }) => void; nonce?: string; ux_mode?: string }): void;
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
    Promise.all([loadGoogleScript(), googleKey()])
      .then(([g, key]) => {
        if (!live || !el.current) return;
        g.accounts.id.initialize({
          client_id: clientId,
          nonce: key.nonce,
          callback: ({ credential }) => {
            setBusy(true);
            signInWithGoogle(credential, key)
              .then(cb.current.onAccount, (e) => cb.current.onError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          },
        });
        // Same width as the wallet button beside it (Google allows 200-400 px).
        const width = Math.max(200, Math.min(400, el.current.offsetWidth || 300));
        g.accounts.id.renderButton(el.current, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width });
      })
      .catch((e) => cb.current.onError(e.message));
    return () => {
      live = false;
    };
  }, [clientId]);
  return (
    <div className="w-full">
      <div ref={el} className="flex min-h-11 w-full items-center justify-center" />
      {busy && <p className="mt-1 text-xs text-muted">Creating your testnet account (about 5 seconds)…</p>}
    </div>
  );
}

export function SignIn({ onSignedIn: signedIn }: { onSignedIn: (accountId: string) => void }) {
  // Everyone who signs in gets a random three-word username, and is remembered as an owner in this browser.
  const onSignedIn = (id: string) => {
    ensureName(id);
    rememberOwner(id);
    signedIn(id);
  };
  const [info, setInfo] = useState<OnboardInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    onboardInfo().then(setInfo, () => setInfo({ enabled: false, parent: null, googleClientId: null }));
  }, []);
  return (
    <Card title="Sign in">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <ActionButton full className="min-h-12 text-base" onClick={async () => onSignedIn(await connectWallet())}>
            Connect a NEAR wallet
          </ActionButton>
          {info?.enabled && info.googleClientId ? (
            <GoogleButton clientId={info.googleClientId} onAccount={onSignedIn} onError={setError} />
          ) : (
            <p className="flex min-h-12 items-center justify-center text-sm text-muted">{info ? "Google sign-in isn't available here." : "…"}</p>
          )}
        </div>
        <ActionButton full tone="quiet" className="min-h-12 text-base" disabled={info !== null && !info.enabled} onClick={async () => onSignedIn(await createDemoAccount())}>
          Try with a demo account
        </ActionButton>
      </div>
      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}
