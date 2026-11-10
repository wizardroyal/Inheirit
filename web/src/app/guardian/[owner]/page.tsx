"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ActAs } from "@/components/ActAs";
import { Ladder } from "@/components/Ladder";
import { ActionButton, Card, ErrorNote, Field, inputCls, Pill, NoWill } from "@/components/ui";
import { TelegramLink } from "@/components/TelegramLink";
import { SignalList } from "@/components/WillParts";
import { useWill } from "@/lib/hooks";
import { call, ROLE_TGAS } from "@/lib/near";
import { ago, guardianIds, stateName } from "@/lib/will";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function GuardianPage() {
  const owner = decodeURIComponent(useParams<{ owner: string }>().owner);
  const { data: will, loaded, refresh } = useWill(owner);
  const [me, setMe] = useState("");
  const [evidence, setEvidence] = useState<{ name: string; hash: string } | null>(null);

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
        <h1 className="font-serif text-3xl">Guardian: {owner}</h1>
        <p className="max-w-2xl text-muted">
          You were chosen because {owner} trusts you to tell the truth. Confirm a passing only with real evidence. If you believe they&apos;re alive,
          say so: one “alive” from any guardian stops the process.
        </p>
        <ActAs value={me} onChange={setMe} suggested={guardianIds(will)} label="I am" />
        {me && !entry && <ErrorNote>{me} is not a guardian of this will.</ErrorNote>}
      </div>
      {entry && !entry.accepted && (
        <Card title="You've been invited">
          <p className="text-sm">
            {owner} asked you to be a guardian. You&apos;ll only be contacted if they go quiet for a long time and a welfare check finds nothing;
            then you&apos;ll be asked to confirm, with evidence, whether they have passed away. Until enough guardians accept, the will can never
            start.
          </p>
          <div className="mt-3">
            <ActionButton onClick={() => call(me, "accept_guardian", { owner }, 0n, ROLE_TGAS).then(refresh)}>I accept the guardian role</ActionButton>
          </div>
        </Card>
      )}
      {isGuardian && (
        <Card title="How we reach you">
          <TelegramLink account={me} purpose="Get welfare checks and vote requests on Telegram (optional)." />
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="What's known">
          <Ladder will={will} />
          <div className="mt-4">
            <SignalList owner={owner} will={will} />
          </div>
        </Card>
        <Card title="Your attestation" aside={voting ? <Pill tone="warn">vote open</Pill> : <Pill>no vote open</Pill>}>
          {!voting && <p className="text-sm text-muted">Guardians are only asked once the owner has been silent and a welfare check found nothing. Nothing to do now.</p>}
          {voting && (
            <div className="space-y-4">
              <p className="text-sm">
                {will.attestations.filter((a) => a.kind === "Deceased").length} of {will.guardian_threshold} guardians have confirmed so far.
              </p>
              <Field label="Evidence (optional)" hint="A death certificate, notice or letter. Only its SHA-256 fingerprint goes on-chain; the file stays on your device.">
                <input
                  type="file"
                  className={inputCls}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    setEvidence(f ? { name: f.name, hash: await sha256Hex(f) } : null);
                  }}
                />
              </Field>
              {evidence && <p className="break-all font-mono text-xs text-muted">sha256 {evidence.hash}</p>}
              {mine ? (
                <p className="text-sm">You attested “{mine.kind}” {ago(mine.at)}.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <ActionButton tone="danger" disabled={!isGuardian} onClick={() => call(me, "attest", { owner, kind: "Deceased", evidence_hash: evidence?.hash ?? null }, 0n, ROLE_TGAS).then(refresh)}>
                    I confirm {owner} has passed away
                  </ActionButton>
                  <ActionButton tone="quiet" disabled={!isGuardian} onClick={() => call(me, "attest", { owner, kind: "Alive", evidence_hash: evidence?.hash ?? null }, 0n, ROLE_TGAS).then(refresh)}>
                    They&apos;re alive
                  </ActionButton>
                </div>
              )}
              <p className="text-xs text-muted">
                After enough confirmations the owner gets a challenge period and is told on every channel. Any sign of life during it cancels
                everything.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
