"use client";
// Final secrets (CLAUDE.md §2.1 insight 3, §8 item 4): optional sealed notes written during setup, sealed in
// this browser to the enclave's key and saved right after the will is created. Released last, per heir.
import { Field, inputCls } from "./ui";

export interface DraftNote {
  heir: string; // heir account
  label: string;
  text: string;
}

const TEMPLATES: { label: string; text: string }[] = [
  { label: "Where the hardware wallet is", text: "My hardware wallet is in [place]. Its PIN is with [person]." },
  { label: "Exchange accounts", text: "I have accounts at [exchanges]. Login email: [email]. Recovery codes are in [place]." },
  { label: "Password manager", text: "My password manager is [app]. The emergency kit is in [place]." },
  { label: "Who holds the passphrase", text: "The seed phrase is in [place]. The passphrase is with [person]. You need both." },
];

/** Notes for heirs, written before the will exists; `heirs` are the will's heirs (account and name). */
export function FinalSecrets({ heirs, notes, onChange }: { heirs: { account: string; name: string }[]; notes: DraftNote[]; onChange: (n: DraftNote[]) => void }) {
  const set = (i: number, patch: Partial<DraftNote>) => onChange(notes.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  const add = (t?: { label: string; text: string }) => onChange([...notes, { heir: heirs[0]?.account ?? "", label: t?.label ?? "", text: t?.text ?? "" }]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Released last, per heir, after everything else is handed over. Split secrets: seed phrase here, passphrase with someone else.</p>
      {notes.map((n, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-line p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className={`${inputCls} sm:w-48`} aria-label="For which heir" value={n.heir} onChange={(e) => set(i, { heir: e.target.value })}>
              {heirs.map((h) => (
                <option key={h.account} value={h.account}>
                  for {h.name || "heir"}
                </option>
              ))}
            </select>
            <input className={`${inputCls} min-w-0 flex-1`} maxLength={64} aria-label="Note title (visible on-chain)" placeholder="Title (visible on-chain)" value={n.label} onChange={(e) => set(i, { label: e.target.value })} />
            <button type="button" className="text-sm text-muted underline" onClick={() => onChange(notes.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          <textarea className={`${inputCls} h-20 w-full`} maxLength={1200} aria-label="Note text (encrypted)" placeholder="What should they know? (Encrypted here.)" value={n.text} onChange={(e) => set(i, { text: e.target.value })} />
        </div>
      ))}
      {heirs.length > 0 && (
        <Field label="Add a note" group>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button key={t.label} type="button" className="min-h-11 rounded-full border border-line bg-card px-4 py-2 text-sm hover:bg-accent-soft" onClick={() => add(t)}>
                {t.label}
              </button>
            ))}
            <button type="button" className="min-h-11 rounded-full border border-line bg-card px-4 py-2 text-sm hover:bg-accent-soft" onClick={() => add()}>
              Blank
            </button>
          </div>
        </Field>
      )}
    </div>
  );
}

/** Notes ready to seal: a heir, a title and some text. */
export const readyNotes = (notes: DraftNote[]) => notes.filter((n) => n.heir && n.label.trim() && n.text.trim());
