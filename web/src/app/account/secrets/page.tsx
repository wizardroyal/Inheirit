"use client";
// Final secrets: sealed notes, released last, per heir.
import { useState } from "react";
import { WillGate } from "@/components/account/home";
import { type DraftNote, FinalSecrets, readyNotes } from "@/components/FinalSecrets";
import { ActionButton, Card, Pill } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { addSealedNote } from "@/lib/demo";
import { useAccountLabel } from "@/lib/names";
import { call } from "@/lib/near";
import { stateName, type Will } from "@/lib/will";

export default function SecretsPage() {
  return <WillGate>{(will) => <Secrets will={will} />}</WillGate>;
}

function Secrets({ will }: { will: Will }) {
  const { refresh, viewing } = useAccount();
  const who = useAccountLabel();
  const [drafts, setDrafts] = useState<DraftNote[]>([]);
  const active = stateName(will.state) === "Active" && !viewing;
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl sm:text-4xl">Final secrets</h1>
      <p className="max-w-2xl text-lg text-muted">Encrypted in this browser to the enclave&apos;s key. Each heir gets theirs last, after everything else and one more wait.</p>
      <Card title="Sealed notes" aside={<Pill>{will.sealed_notes.length} of 10</Pill>}>
        {will.sealed_notes.length ? (
          <ul className="divide-y divide-line">
            {will.sealed_notes.map((n) => {
              const released = will.released_notes.some((r) => r.note_id === n.id);
              return (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="text-lg">
                    {n.label} <span className="text-muted">for {who(n.heir)}</span> {released && <Pill tone="accent">released</Pill>}
                  </span>
                  {active && (
                    <ActionButton tone="quiet" onClick={() => call(will.owner, "remove_sealed_note", { note_id: n.id }).then(refresh)}>
                      Remove
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted">No notes yet.</p>
        )}
      </Card>
      {active && (
        <Card title="Write a note">
          <FinalSecrets heirs={will.heirs.map((h) => ({ account: h.account_id, name: h.name }))} notes={drafts} onChange={setDrafts} />
          {readyNotes(drafts).length > 0 && (
            <div className="mt-4">
              <ActionButton
                onClick={async () => {
                  for (const n of readyNotes(drafts)) await addSealedNote(will.owner, n.heir, n.label.trim(), n.text);
                  setDrafts([]);
                  refresh();
                }}
              >
                Seal and save
              </ActionButton>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
