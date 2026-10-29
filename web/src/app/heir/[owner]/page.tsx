"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ActAs } from "@/components/ActAs";
import { AiBadge } from "@/components/Attestation";
import { ActionButton, Card, ErrorNote, inputCls, Pill } from "@/components/ui";
import { Releases } from "@/components/WillParts";
import { useKeys, usePoll, useWill } from "@/lib/hooks";
import { keys } from "@/lib/keys";
import { agent } from "@/lib/agent";
import { call, signRequest, view } from "@/lib/near";
import { keypairFromSeedHex, newSeedHex, openReleased, pubkeyHex } from "@/lib/sealed";
import { stateName, type Will } from "@/lib/will";

type Released = Will["released_notes"][number];

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <Card title={`${n} · ${title}`} aside={done ? <Pill tone="accent">done</Pill> : undefined}>
      {children}
    </Card>
  );
}

export default function HeirPage() {
  const owner = decodeURIComponent(useParams<{ owner: string }>().owner);
  const { data: will, loaded, refresh } = useWill(owner, 5000);
  const [me, setMe] = useState("");
  useKeys(); // re-render when the local key store changes

  if (!loaded) return <p>Loading…</p>;
  if (!will) return <ErrorNote>No will for {owner}.</ErrorNote>;
  const heir = will.heirs.find((h) => h.account_id === me);
  const s = stateName(will.state);
  const started = s === "Executing" || s === "Completed" || will.execution_round > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl">For the heirs of {owner}</h1>
        <p className="max-w-2xl text-muted">
          {started
            ? `${owner}'s will is being carried out. This page walks you through what you receive and any private notes left for you.`
            : `Nothing has been released. ${owner}'s will is in the "${s}" state. You can set up your key now so you're ready.`}
        </p>
      </div>
      <Step n={1} title="Who are you?" done={!!heir}>
        <ActAs value={me} onChange={setMe} suggested={will.heirs.map((h) => h.account_id)} label="I am" />
        {me && !heir && <p className="mt-2 text-sm text-danger">{me} is not an heir of this will.</p>}
        {heir && <p className="mt-2 text-sm">Welcome, {heir.name}.</p>}
      </Step>
      {heir && <KeyStep owner={owner} heir={heir} refresh={refresh} />}
      {heir && (
        <Step n={3} title="What you receive">
          <p className="mb-3 text-sm text-muted">
            Assets are released in stages: {will.stages_pct.map((p) => `${p}%`).join(", ")}. If {owner} turns out to be alive, the remaining stages stop.
          </p>
          <Releases will={will} />
        </Step>
      )}
      {heir && <NotesStep owner={owner} will={will} heir={heir.account_id} />}
      {heir && <GuideChat owner={owner} heir={heir.account_id} />}
    </div>
  );
}

function KeyStep({ owner, heir, refresh }: { owner: string; heir: Will["heirs"][number]; refresh: () => void }) {
  const seed = keys.heirSeed(owner, heir.account_id);
  const { data: localPub } = usePoll(async () => (seed ? pubkeyHex(await keypairFromSeedHex(seed)) : null), 60_000, [seed]);
  const registered = heir.x25519_pubkey;
  const matches = !!registered && registered === localPub;
  return (
    <Step n={2} title="Your private key for notes" done={matches}>
      <p className="text-sm text-muted">
        Notes for you are encrypted to a key that only exists on your device. Create it here; only the public half goes on-chain.
      </p>
      {registered && !seed && (
        <p className="mt-2 text-sm text-warn">A key is registered for you, but this browser doesn&apos;t have it. Restore your backup, or create a new one if no notes were released to you yet.</p>
      )}
      {registered && seed && !matches && localPub && <p className="mt-2 text-sm text-warn">This browser&apos;s key differs from the registered one.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!matches && (
          <ActionButton
            onClick={async () => {
              const s = seed ?? (await newSeedHex());
              keys.setHeirSeed(owner, heir.account_id, s);
              const pub = await pubkeyHex(await keypairFromSeedHex(s));
              await call(heir.account_id, "register_heir_key", { owner, x25519_pubkey: pub });
              refresh();
            }}
          >
            {seed ? "Register this browser's key" : "Create and register my key"}
          </ActionButton>
        )}
        {seed && (
          <button
            type="button"
            className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-accent-soft"
            onClick={() => {
              const blob = new Blob([JSON.stringify({ owner, heir: heir.account_id, x25519_seed_hex: seed }, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `inheirit-key-${heir.account_id}.json`;
              a.click();
            }}
          >
            Download a backup
          </button>
        )}
        <RestoreKey owner={owner} heir={heir.account_id} />
      </div>
    </Step>
  );
}

function RestoreKey({ owner, heir }: { owner: string; heir: string }) {
  return (
    <label className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm hover:bg-accent-soft">
      Restore from backup
      <input
        type="file"
        accept="application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const j = JSON.parse(await f.text()) as { x25519_seed_hex?: string };
          if (j.x25519_seed_hex && /^[0-9a-f]{64}$/.test(j.x25519_seed_hex)) keys.setHeirSeed(owner, heir, j.x25519_seed_hex);
        }}
      />
    </label>
  );
}

function NotesStep({ owner, will, heir }: { owner: string; will: Will; heir: string }) {
  const { data: released } = usePoll(() => view<Released[]>("get_released_notes", { owner, heir }), 8000, [owner, heir]);
  const [opened, setOpened] = useState<Record<number, string>>({});
  const waiting = will.sealed_notes.filter((n) => n.heir === heir && !(released ?? []).some((r) => r.note_id === n.id));
  return (
    <Step n={4} title="Private notes left for you">
      {(released ?? []).length === 0 && waiting.length === 0 && <p className="text-sm text-muted">No notes were left for you.</p>}
      {waiting.length > 0 && (
        <p className="text-sm text-muted">
          {waiting.length} sealed note{waiting.length > 1 ? "s" : ""} ({waiting.map((n) => `“${n.label}”`).join(", ")}) will be released to your key once
          execution starts. The agent opens them inside its TEE and re-seals them to you.
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {(released ?? []).map((n) => (
          <li key={n.note_id} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{n.label}</span>
              {!opened[n.note_id] && (
                <ActionButton
                  onClick={async () => {
                    const seed = keys.heirSeed(owner, heir);
                    if (!seed) throw new Error("This browser doesn't have your key. Restore your backup first.");
                    const text = await openReleased(n.ciphertext, await keypairFromSeedHex(seed)).catch(() => {
                      throw new Error("This note wasn't sealed to the key in this browser.");
                    });
                    setOpened((o) => ({ ...o, [n.note_id]: text }));
                  }}
                >
                  Decrypt here
                </ActionButton>
              )}
            </div>
            {opened[n.note_id] && <p className="mt-2 whitespace-pre-wrap rounded bg-accent-soft p-3 text-sm">{opened[n.note_id]}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Decryption happens in this browser. The plaintext is never sent anywhere.</p>
    </Step>
  );
}

type Turn = { role: "user" | "assistant"; content: string };

function GuideChat({ owner, heir }: { owner: string; heir: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const ask = async () => {
    const question = q.trim();
    if (!question) return;
    const history = turns;
    setTurns([...history, { role: "user", content: question }]);
    setQ("");
    try {
      const r = await agent.heirGuide(await signRequest(heir, "heir_guide", { owner, question, history }));
      setTurns([...history, { role: "user", content: question }, { role: "assistant", content: r.ok ? r.answer! : `(${r.error})` }]);
    } catch (e) {
      setTurns(history);
      setQ(question);
      throw e;
    }
  };
  return (
    <Card title="Questions? Ask the guide" aside={<AiBadge />}>
      <p className="mb-3 text-sm text-muted">
        Answers come from a private model on NEAR AI Cloud running in a TEE. It sees only your own claim details, never your notes. Never share a seed
        phrase or password with anyone, including here.
      </p>
      <ul className="mb-3 space-y-2">
        {turns.map((t, i) => (
          <li key={i} className={`rounded-lg px-3 py-2 text-sm ${t.role === "user" ? "ml-10 bg-bg" : "mr-10 bg-accent-soft"}`}>
            {t.content}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} min-w-0 flex-1`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="What happens next? What is a sealed note?"
          maxLength={1000}
        />
        <ActionButton disabled={!q.trim()} onClick={ask}>
          Ask
        </ActionButton>
      </div>
    </Card>
  );
}
