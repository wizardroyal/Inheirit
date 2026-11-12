"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ActAs } from "@/components/ActAs";
import { BackToOwner } from "@/components/Speedrun";
import { Ladder } from "@/components/Ladder";
import { ActionButton, Card, ErrorNote, Field, inputCls, Pill, NoWill } from "@/components/ui";
import { TelegramLink } from "@/components/TelegramLink";
import { SignalList } from "@/components/WillParts";
import { useActingAs, useWill, useOwnerName } from "@/lib/hooks";
import { useAccountLabel } from "@/lib/names";
import { call, ROLE_TGAS } from "@/lib/near";
import { ago, guardianIds, stateName } from "@/lib/will";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The lawyer's death proof (§5.5): it only shortens the remaining waits. It never skips the guardian vote
 * or the challenge period, and it's accepted only in GuardianVote, Challenge or Executing.
 */
function LawyerCard({ owner, lawyer, state, accelerated, refresh }: { owner: string; lawyer: string; state: string; accelerated: boolean; refresh: () => void }) {
  const [evidence, setEvidence] = useState<{ name: string; hash: string } | null>(null);
  const open = ["GuardianVote", "Challenge", "Executing"].includes(state);
  return (
    <Card title="Lawyer: death certificate" aside={accelerated ? <Pill tone="warn">faster schedule on</Pill> : undefined}>
      <p className="text-sm text-muted">
        Shortens the remaining waits (10/30/60%, 14 days apart). Never skips the guardian vote or the challenge period.
      </p>
      {accelerated ? (
        <p className="mt-3 text-sm">Certificate on record: faster schedule.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <Field label="Certificate" hint="Only its SHA-256 goes on-chain.">
            <input
              type="file"
              className={`${inputCls} w-full min-w-0`}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setEvidence(f ? { name: f.name, hash: await sha256Hex(f) } : null);
              }}
            />
          </Field>
          <ActionButton
            tone="danger"
            disabled={!open || !evidence}
            onClick={() => call(lawyer, "attest_death_proof", { owner, evidence_hash: evidence!.hash }, 0n, ROLE_TGAS).then(refresh)}
          >
            File the death certificate
          </ActionButton>
          {!open && <p className="text-xs text-muted">Open from the guardian vote until the release ends.</p>}
        </div>
      )}
    </Card>
  );
}

export default function GuardianPage() {
  const owner = decodeURIComponent(useParams<{ owner: string }>().owner);
  const { data: will, loaded, refresh } = useWill(owner);
  const [me, setMe] = useActingAs();
  const [evidence, setEvidence] = useState<{ name: string; hash: string } | null>(null);
  const ownerName = useOwnerName(owner);
  const label = useAccountLabel();

  if (!loaded) return <p>Loading…</p>;
  if (!will) return <NoWill owner={owner} />;
  const s = stateName(will.state);
  const entry = will.guardians.find((g) => g.account_id === me);
  const isGuardian = !!entry?.accepted;
  const mine = will.attestations.find((a) => a.guardian === me);
  const voting = s === "GuardianVote";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackToOwner owner={owner} />
        <h1 className="font-serif text-4xl">{me && me === will.lawyer ? "Lawyer" : "Guardian"} for {ownerName}</h1>
        <p className="max-w-2xl text-muted">
          Confirm a passing only if you&apos;re sure. One “they&apos;re alive” from any guardian stops everything.
        </p>
        <ActAs value={me} onChange={setMe} suggested={[...guardianIds(will), ...(will.lawyer ? [will.lawyer] : [])]} label="I am" />
        {me && !entry && me !== will.lawyer && <ErrorNote>{label(me)} isn&apos;t a guardian or the lawyer for this will.</ErrorNote>}
      </div>
      {me && me === will.lawyer && <LawyerCard owner={owner} lawyer={me} state={s} accelerated={will.accelerated} refresh={refresh} />}
      {entry && !entry.accepted && (
        <Card title="You've been invited">
          <p className="text-sm">
            {ownerName} asked you to be a guardian. You&apos;ll hear from us only if they go quiet and nobody has heard from them.
          </p>
          <div className="mt-3">
            <ActionButton onClick={() => call(me, "accept_guardian", { owner }, 0n, ROLE_TGAS).then(refresh)}>I accept the guardian role</ActionButton>
          </div>
        </Card>
      )}
      {isGuardian && (
        <Card title="How we reach you">
          <TelegramLink account={me} purpose="Optional: get checks and vote requests on Telegram." />
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="What we know">
          <Ladder will={will} />
          <div className="mt-4">
            <SignalList owner={owner} will={will} />
          </div>
        </Card>
        <Card title="Your answer" aside={voting ? <Pill tone="warn">vote open</Pill> : <Pill>no vote open</Pill>}>
          {!voting && (
            <p className="text-sm text-muted">
              {s === "Challenge"
                ? `Enough guardians confirmed. ${ownerName} is being alerted; a sign of life still cancels.`
                : s === "Completed"
                  ? "The will has been carried out."
                  : ["Executing", "SecretsBuffer", "SecretsReleased"].includes(s)
                    ? "The will is being carried out."
                    : "Nothing to do now."}
            </p>
          )}
          {voting && (
            <div className="space-y-4">
              <p className="text-sm">
                {will.attestations.filter((a) => a.kind === "Deceased").length} of {will.guardian_threshold} guardians have confirmed so far.
              </p>
              <Field label="Evidence (optional)" hint="Certificate, notice or letter. Only its SHA-256 goes on-chain.">
                <input
                  type="file"
                  className={`${inputCls} w-full min-w-0`}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    setEvidence(f ? { name: f.name, hash: await sha256Hex(f) } : null);
                  }}
                />
              </Field>
              {evidence && <p className="break-all font-mono text-xs text-muted">sha256 {evidence.hash}</p>}
              {mine ? (
                <p className="text-sm">{mine.kind === "Deceased" ? "You confirmed their passing" : "You said they're alive"} {ago(mine.at)}.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <ActionButton tone="danger" disabled={!isGuardian} onClick={() => call(me, "attest", { owner, kind: "Deceased", evidence_hash: evidence?.hash ?? null }, 0n, ROLE_TGAS).then(refresh)}>
                    I confirm {ownerName} has passed away
                  </ActionButton>
                  <ActionButton tone="quiet" disabled={!isGuardian} onClick={() => call(me, "attest", { owner, kind: "Alive", evidence_hash: evidence?.hash ?? null }, 0n, ROLE_TGAS).then(refresh)}>
                    They&apos;re alive
                  </ActionButton>
                </div>
              )}
              <p className="text-xs text-muted">
                Then a challenge period; any sign of life cancels.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
