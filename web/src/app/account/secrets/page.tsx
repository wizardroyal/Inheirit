"use client";
// Final secrets: encrypted instructions for heirs, released last. A sealed note can't be read back (only
// the enclave can open it), so "Edit" writes a replacement: the new one is sealed, then the old one removed.
import { useState } from "react";
import { WillGate } from "@/components/account/home";
import { type DraftNote, FinalSecrets, readyNotes } from "@/components/FinalSecrets";
import { ActionButton, Card, ConfirmButton, ErrorNote, inputCls, Pill } from "@/components/ui";
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
  const [editing, setEditing] = useState<{ id: number; heir: string; label: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = stateName(will.state) === "Active" && !viewing;
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl sm:text-4xl">Final secrets</h1>
      <p className="max-w-2xl text-lg">Encrypted instructions for your heirs. They receive these last.</p>
      <Card title="Your secrets" aside={<Pill>{will.sealed_notes.length} of 10</Pill>}>
        {will.sealed_notes.length ? (
          <ul className="divide-y divide-line">
            {will.sealed_notes.map((n) => {
              const released = will.released_notes.some((r) => r.note_id === n.id);
              return (
                <li key={n.id} className="space-y-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-lg">
                      {n.label} <span className="text-muted">for {who(n.heir)}</span> {released && <Pill tone="accent">released</Pill>}
                    </span>
                    {active && !released && (
                      <span className="flex flex-wrap items-center gap-2">
                        <button type="button" className="min-h-11 rounded-lg border border-line px-4 py-2 hover:bg-accent-soft" onClick={() => setEditing({ id: n.id, heir: n.heir, label: n.label, text: "" })}>
                          Edit
                        </button>
                        <ConfirmButton label="Delete" question="Delete this secret?" onConfirm={() => call(will.owner, "remove_sealed_note", { note_id: n.id }).then(refresh)} />
                      </span>
                    )}
                  </div>
                  {editing?.id === n.id && (
                    <div className="space-y-2 rounded-lg border border-line p-3">
                      <p className="text-sm text-muted">Sealed text can&apos;t be shown again, not even to you. Write the new version; it replaces the old one.</p>
                      <input className={`${inputCls} w-full`} maxLength={64} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} aria-label="Title (visible on-chain)" />
                      <textarea className={`${inputCls} h-24 w-full`} maxLength={1200} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} aria-label="New text (encrypted)" placeholder="The new instructions…" />
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          disabled={!editing.label.trim() || !editing.text.trim()}
                          onClick={async () => {
                            setError(null);
                            try {
                              await addSealedNote(will.owner, editing.heir, editing.label.trim(), editing.text);
                              await call(will.owner, "remove_sealed_note", { note_id: editing.id });
                              setEditing(null);
                              refresh();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : String(e));
                            }
                          }}
                        >
                          Seal the new version
                        </ActionButton>
                        <button type="button" className="min-h-11 px-3 text-muted underline" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted">No secrets yet. Instructions often work better than raw keys: where the hardware wallet is, who holds the passphrase.</p>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </Card>
      {active && (
        <Card title="Add a secret">
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
