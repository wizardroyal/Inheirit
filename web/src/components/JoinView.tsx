"use client";
// An invite link (web/src/lib/invites.ts): someone without a NEAR account opens it, signs in (Google, a
// wallet or a demo account) and takes the role. The code stays in the #fragment, never sent to a server.
import Link from "next/link";
import { useState } from "react";
import { SignIn } from "@/components/SignIn";
import { ActionButton, Card, ErrorNote } from "@/components/ui";
import { useOwnerName, usePoll } from "@/lib/hooks";
import { claimInvite, inviteOpen } from "@/lib/invites";
import { nameAccounts } from "@/lib/names";
import { duration } from "@/lib/will";

const ROLE_TEXT: Record<string, string> = {
  guardian: "a guardian. If they go quiet, you're asked whether they've passed away; one “they're alive” stops it.",
  friend: "a friend for welfare checks. You can only stop things, never start them.",
  lawyer: "their lawyer. Your death certificate speeds up the release but never skips a step.",
};

export function JoinView({ owner, code, role, name }: { owner: string; code: string; role: string; name: string }) {
  const ownerName = useOwnerName(owner);
  // The answer carries the code it was checked for, so a stale empty answer never shows as "used".
  const { data } = usePoll(async () => ({ code, invite: code ? await inviteOpen(owner, code) : null }), 30_000, [owner, code]);
  const checked = data?.code === code && !!code;
  const invite = checked ? data!.invite : null;
  const [me, setMe] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!code) return <ErrorNote>This link is missing its code. Ask {ownerName} to send it again.</ErrorNote>;
  const page = role === "guardian" || role === "lawyer" ? "guardian" : "contact";

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="font-serif text-4xl">{ownerName} invited you{name ? `, ${name}` : ""}</h1>
      <p className="text-muted">To be {ROLE_TEXT[invite?.role ?? role] ?? "part of their will."}</p>
      {checked && !invite && !done && <ErrorNote>This invite was already used, cancelled or has expired. Ask {ownerName} for a new link.</ErrorNote>}
      {invite && !done && (
        <Card>
          <p className="mb-3 text-xs text-muted">One use · expires in {duration(Math.max(0, invite.expires_at - Math.floor(Date.now() / 1000)))}</p>
          {!me ? (
            <>
              <p className="mb-3 text-sm">Sign in to accept. No crypto needed: Google makes you an account.</p>
              <SignIn onSignedIn={setMe} />
            </>
          ) : (
            <ActionButton
              onClick={async () => {
                await claimInvite(me, owner, code);
                if (name) nameAccounts({ [me]: name });
                setDone(true);
              }}
            >
              Accept
            </ActionButton>
          )}
        </Card>
      )}
      {done && me && (
        <Card>
          <p className="text-sm">Done. You&apos;re in. Nothing to do now; you&apos;ll be asked only if {ownerName} goes quiet.</p>
          <Link className="mt-2 inline-block text-sm text-accent underline" href={`/${page}/${owner}?as=${me}`}>
            Open your page
          </Link>
        </Card>
      )}
    </div>
  );
}
