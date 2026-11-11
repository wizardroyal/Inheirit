"use client";
// Welfare-check link sent to contacts (the agent's WelfareCheck notification points here).
import { useParams } from "next/navigation";
import { ActAs } from "@/components/ActAs";
import { BackToOwner } from "@/components/Speedrun";
import { ActionButton, Card, NoWill } from "@/components/ui";
import { useActingAs, useWill, useOwnerName } from "@/lib/hooks";
import { useAccountLabel } from "@/lib/names";
import { call, ROLE_TGAS } from "@/lib/near";
import { acceptedGuardians, stateName } from "@/lib/will";

export default function ContactPage() {
  const owner = decodeURIComponent(useParams<{ owner: string }>().owner);
  const { data: will, loaded, refresh } = useWill(owner);
  const [me, setMe] = useActingAs();
  const ownerName = useOwnerName(owner);
  const label = useAccountLabel();
  if (!loaded) return <p>Loading…</p>;
  if (!will) return <NoWill owner={owner} />;
  const s = stateName(will.state);
  const open = s === "Quiet" || s === "WelfareCheck";
  // The welfare chain: friends, accepted guardians and the lawyer may all confirm the owner is fine (§5.5).
  const askable = [...will.contacts, ...acceptedGuardians(will), ...(will.lawyer ? [will.lawyer] : [])];
  return (
    <div className="max-w-xl space-y-4">
      <BackToOwner owner={owner} />
      <h1 className="font-serif text-4xl">Have you heard from {ownerName}?</h1>
      <p className="text-muted">
        {ownerName} listed you as someone who&apos;d know if they were okay, and they&apos;ve been quiet for a while. If you&apos;ve heard from them recently,
        say so below and nothing else happens.
      </p>
      <Card>
        <ActAs value={me} onChange={setMe} suggested={askable} label="I am" />
        <div className="mt-3">
          {open ? (
            <ActionButton disabled={!askable.includes(me)} onClick={() => call(me, "contact_confirm_alive", { owner }, 0n, ROLE_TGAS).then(refresh)}>
              Yes, they&apos;re fine
            </ActionButton>
          ) : (
            <p className="text-sm text-muted">
              {s === "Active"
                ? `No check is needed right now: ${ownerName} is active.`
                : s === "GuardianVote" || s === "Challenge"
                  ? "The welfare check has closed, and the guardians now decide."
                  : "The will has moved past the welfare check."}
            </p>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">Your answer can only stop the process, never start it.</p>
        {me && !askable.includes(me) && <p className="mt-1 text-xs text-danger">{label(me)} isn&apos;t one of the people this will asks.</p>}
      </Card>
    </div>
  );
}
