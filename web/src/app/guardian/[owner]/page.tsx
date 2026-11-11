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
        A death certificate shortens the remaining waits (before the release: 10% → 30% → 60%, 14 days apart for real wills; once it has begun,
        the remaining slices keep their sizes and only the waits get shorter). It never skips the guardian vote or the challenge period, so it
        can&apos;t be used to rush the will of someone who is still alive.
      </p>
      {accelerated ? (
        <p className="mt-3 text-sm">A death certificate is on record, so the faster schedule applies.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <Field label="Certificate" hint="Only its fingerprint (SHA-256) goes on-chain; the file never leaves your device.">
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
          {!open && <p className="text-xs text-muted">You can file it once the guardian vote has started, and until the release ends.</p>}
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
          {ownerName} chose you because they trust you to tell the truth. Confirm a passing only if you&apos;re sure. If you believe they&apos;re alive,
          say so: one “they&apos;re alive” from any guardian stops everything.
        </p>
        <ActAs value={me} onChange={setMe} suggested={[...guardianIds(will), ...(will.lawyer ? [will.lawyer] : [])]} label="I am" />
        {me && !entry && me !== will.lawyer && <ErrorNote>{label(me)} isn&apos;t a guardian or the lawyer for this will.</ErrorNote>}
      </div>
      {me && me === will.lawyer && <LawyerCard owner={owner} lawyer={me} state={s} accelerated={will.accelerated} refresh={refresh} />}
      {entry && !entry.accepted && (
        <Card title="You've been invited">
          <p className="text-sm">
            {ownerName} has asked you to be a guardian. You&apos;ll only hear from us if they go quiet for a long time and nobody in a welfare check has
            heard from them. Then you&apos;ll be asked whether they have passed away. Until enough guardians accept, the will can never start.
          </p>
          <div className="mt-3">
            <ActionButton onClick={() => call(me, "accept_guardian", { owner }, 0n, ROLE_TGAS).then(refresh)}>I accept the guardian role</ActionButton>
          </div>
        </Card>
      )}
      {isGuardian && (
        <Card title="How we reach you">
          <TelegramLink account={me} purpose="Optional: get welfare checks and vote requests on Telegram." />
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
                ? `Enough guardians have confirmed. ${ownerName} is being alerted; any sign of life still cancels.`
                : s === "Completed"
                  ? "The will has been carried out. Nothing more is needed from you."
                  : ["Executing", "SecretsBuffer", "SecretsReleased"].includes(s)
                    ? "The will is being carried out. Nothing is needed from you."
                    : `Nothing to do now. Guardians are only asked once ${ownerName} has been silent and nobody in the welfare check has heard from them.`}
            </p>
          )}
          {voting && (
            <div className="space-y-4">
              <p className="text-sm">
                {will.attestations.filter((a) => a.kind === "Deceased").length} of {will.guardian_threshold} guardians have confirmed so far.
              </p>
              <Field label="Evidence (optional)" hint="A death certificate, notice or letter. Only its fingerprint (SHA-256) goes on-chain; the file never leaves your device.">
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
                Once enough guardians confirm, the owner is alerted on every channel and a challenge period begins. Any sign of life during it
                cancels everything.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
