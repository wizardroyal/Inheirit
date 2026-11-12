"use client";
// Link a Telegram chat to a NEAR account (agent §7.7), the same everywhere: one button opens Telegram,
// then we wait for Start and confirm. The request is signed with the account's key in this browser.
import { useState } from "react";
import { agent } from "@/lib/agent";
import { usePoll } from "@/lib/hooks";
import { signRequest } from "@/lib/near";
import { ErrorNote, ExtLink } from "./ui";

export function TelegramLink({ account, purpose }: { account: string; purpose?: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every 3 s while we wait for Start; otherwise rarely.
  const { data: status } = usePoll(() => agent.telegramStatus(account), link ? 3000 : 10 * 60_000, [account, !!link]);

  if (!status?.enabled) return null;
  if (status.linked) return <p className="text-accent">Telegram linked ✓</p>;
  const token = link ? new URL(link).searchParams.get("start") : null;
  return (
    <div className="space-y-2">
      {purpose && <p className="text-muted">{purpose}</p>}
      {!link ? (
        <button
          type="button"
          className="min-h-11 rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink hover:opacity-90"
          onClick={async () => {
            setError(null);
            // Open the window on the click itself (browsers block pop-ups opened later), then point it at Telegram.
            const w = window.open("about:blank", "_blank");
            try {
              const url = (await agent.telegramLink(await signRequest(account, "telegram_link"))).url;
              setLink(url);
              if (w) w.location.href = url;
            } catch (e) {
              w?.close();
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Link Telegram
        </button>
      ) : (
        <div className="space-y-2">
          <p aria-live="polite">Waiting for you to press Start in Telegram…</p>
          <details className="text-sm text-muted">
            <summary className="cursor-pointer">Link didn&apos;t open?</summary>
            <p className="mt-1">
              Open <ExtLink href={link}>this link</ExtLink> (valid 15 minutes), or send @{status.bot}: <code className="break-all">/start {token}</code>
            </p>
          </details>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
