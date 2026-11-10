"use client";
// Welfare-check link sent to contacts (the agent's WelfareCheck notification points here).
import { useParams } from "next/navigation";
import { useState } from "react";
import { ActAs } from "@/components/ActAs";
import { BackToOwner } from "@/components/Speedrun";
import { ActionButton, Card, NoWill } from "@/components/ui";
import { initialAs, useWill } from "@/lib/hooks";
import { call, ROLE_TGAS } from "@/lib/near";
import { stateName } from "@/lib/will";

export default function ContactPage() {
  const owner = decodeURIComponent(useParams<{ owner: string }>().owner);
  const { data: will, loaded, refresh } = useWill(owner);
  const [me, setMe] = useState(initialAs);
  if (!loaded) return <p>Loading…</p>;
  if (!will) return <NoWill owner={owner} />;
  const s = stateName(will.state);
  const open = s === "Quiet" || s === "WelfareCheck";
  return (
    <div className="max-w-xl space-y-4">
      <BackToOwner owner={owner} />
      <h1 className="font-serif text-3xl">Have you heard from {owner}?</h1>
      <p className="text-muted">
        {owner} listed you as someone who&apos;d know if they were okay. They&apos;ve been quiet online for a while. If you&apos;ve heard from them recently, say so
        below and nothing else happens.
      </p>
      <Card>
        <ActAs value={me} onChange={setMe} suggested={will.contacts} label="I am" />
        <div className="mt-3">
          {open ? (
            <ActionButton disabled={!will.contacts.includes(me)} onClick={() => call(me, "contact_confirm_alive", { owner }, 0n, ROLE_TGAS).then(refresh)}>
              Yes, they&apos;re fine
            </ActionButton>
          ) : (
            <p className="text-sm text-muted">{s === "Active" ? "Thanks — no check is needed right now." : "The welfare check has closed; guardians now decide."}</p>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">This can only delay the process, never start it.</p>
      </Card>
    </div>
  );
}
