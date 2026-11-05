"use client";
// Link a Telegram chat to a NEAR account (agent §7.7). The request is signed with the account's key in
// this browser; the agent returns a one-time t.me link. Some desktop clients don't pass the link's
// token when the chat already exists, so the same token is shown as a message to paste.
import { useEffect, useState } from "react";
import { agent } from "@/lib/agent";
import { signRequest } from "@/lib/near";
import { ActionButton, ExtLink, Pill } from "./ui";

export function TelegramLink({ account, purpose }: { account: string; purpose: string }) {
  const [status, setStatus] = useState<{ enabled: boolean; bot?: string; linked: boolean } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => agent.telegramStatus(account).then((s) => live && setStatus(s), () => live && setStatus(null));
    load();
    const id = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [account]);

  if (!status?.enabled) return null;
  if (status.linked) return <Pill tone="accent">Telegram linked</Pill>;
  const token = link ? new URL(link).searchParams.get("start") : null;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted">{purpose}</p>
      {!link ? (
        <ActionButton tone="quiet" onClick={async () => setLink((await agent.telegramLink(await signRequest(account, "telegram_link"))).url)}>
          Link Telegram
        </ActionButton>
      ) : (
        <div className="space-y-1">
          <p>
            Open <ExtLink href={link}>this link</ExtLink> and press Start (valid 15 minutes).
          </p>
          <p className="text-xs text-muted">
            If you already chat with @{status.bot}, send it this message instead: <code className="break-all">/start {token}</code>
          </p>
        </div>
      )}
    </div>
  );
}
