"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ActAs } from "@/components/ActAs";
import { BackToOwner } from "@/components/Speedrun";
import { AiBadge } from "@/components/Attestation";
import { ActionButton, Card, inputCls, Pill, NoWill } from "@/components/ui";
import { Releases } from "@/components/WillParts";
import { HeirPayoutList, IntentsSimTag, PayoutChoice } from "@/components/Payouts";
import { useActingAs, useKeys, usePoll, useWill, useOwnerName } from "@/lib/hooks";
import { useAccountLabel } from "@/lib/names";
import { keys } from "@/lib/keys";
import { agent } from "@/lib/agent";
import { call, ROLE_TGAS, signRequest, view } from "@/lib/near";
import { keypairFromSeedHex, newSeedHex, openReleased, pubkeyHex } from "@/lib/sealed";
import { executionStarted, schedule, stateName, type Will, stateLabel } from "@/lib/will";

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
  const { data: will, loaded, refresh } = useWill(owner);
  const [me, setMe] = useActingAs();
  const ownerName = useOwnerName(owner);
  const ownerLabel = useAccountLabel();
  useKeys(); // re-render when the local key store changes

  if (!loaded) return <p>Loading…</p>;
  if (!will) return <NoWill owner={owner} />;
  const heir = will.heirs.find((h) => h.account_id === me);
  const s = stateName(will.state);
  const started = executionStarted(will.state);
  // Released, then stopped by a sign of life: the owner is alive, so no condolences.
  const halted = !started && will.execution_round > 0 && will.halted.some((h) => h.round === will.execution_round);
  // Heirs hidden (CLAUDE.md §8): don't list who inherits to visitors before execution. The contract
  // state itself stays readable on-chain; this is a UI-level limit.
  const suggested = will.heirs_hidden && !started ? [] : will.heirs.map((h) => h.account_id);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackToOwner owner={owner} />
        <h1 className="font-serif text-4xl">For the heirs of {ownerName}</h1>
        <p className="max-w-2xl text-muted">
          {started
            ? `We're sorry for your loss. ${ownerName}'s will is being carried out, and this page walks you through it one step at a time: what you receive, how you'd like to receive it, and any private notes left for you. There's no rush.`
            : halted
              ? `Part of ${ownerName}'s will was released, then stopped because ${ownerName} showed a sign of life. Nothing more will move unless the guardians confirm again.`
              : `Nothing has been released, and nothing will be unless ${ownerName}'s guardians confirm they have passed away. Right now the will is at “${stateLabel(s)}”. If you like, you can set up your key now, so you're ready if that day comes.`}
        </p>
      </div>
      <Step n={1} title="Who you are" done={!!heir}>
        <ActAs value={me} onChange={setMe} suggested={suggested} label="I am" />
        {me && !heir && <p className="mt-2 text-sm text-danger">{ownerLabel(me)} isn&apos;t an heir of this will.</p>}
        {heir && <p className="mt-2 text-sm">Hello, {heir.name}.</p>}
      </Step>
      {heir && <KeyStep owner={owner} heir={heir} refresh={refresh} />}
      {heir && (
        <Step n={3} title="What you receive">
          <p className="mb-3 text-sm text-muted">
            What you receive arrives in stages ({schedule(will).map((st) => `${st.pct}%`).join(", ")}){will.accelerated ? "" : ", with the longest wait after the first"}. If it
            turns out {ownerName} is alive after all, everything stops. Private notes come last, after everything else has been handed over.
          </p>
          <Releases will={will} />
        </Step>
      )}
      {heir && <PayoutStep owner={owner} heir={heir.account_id} />}
      {heir && <NotesStep owner={owner} will={will} heir={heir.account_id} />}
      {heir && <GuideChat owner={owner} heir={heir.account_id} />}
    </div>
  );
}

function PayoutStep({ owner, heir }: { owner: string; heir: string }) {
  const ownerName = useOwnerName(owner);
  const { data, refresh } = usePoll(() => agent.payouts(owner, heir), 6000, [owner, heir]);
  const mine = data?.heirs[heir];
  return (
    <Step n={4} title="How you'd like to receive it" done={!!mine?.pref}>
      <p className="mb-3 text-sm text-muted">
        You can receive your inheritance in whatever you already use: US dollars (USDC) on Base, SOL on Solana, NEAR and more. Each slice goes on through NEAR Intents to the
        asset and chain you choose{data?.value_mode === "stable" ? `. ${ownerName} chose to pay in dollars, so it arrives as USDC on that chain` : ""}.
        {data?.simulated && (
          <>
            {" "}
            <IntentsSimTag /> on testnet: NEAR Intents has no testnet, so the swap is simulated, priced with live quotes.
          </>
        )}
      </p>
      <PayoutChoice owner={owner} heir={heir} current={mine?.pref ?? null} onSaved={refresh} />
      {mine && (
        <div className="mt-4">
          <HeirPayoutList p={mine} minUsd={data!.min_usd} mine />
        </div>
      )}
    </Step>
  );
}

function KeyStep({ owner, heir, refresh }: { owner: string; heir: Will["heirs"][number]; refresh: () => void }) {
  const seed = keys.heirSeed(owner, heir.account_id);
  const { data: localPub } = usePoll(async () => (seed ? pubkeyHex(await keypairFromSeedHex(seed)) : null), 60_000, [seed]);
  const registered = heir.x25519_pubkey;
  const matches = !!registered && registered === localPub;
  return (
    <Step n={2} title="A key for private notes" done={matches}>
      <p className="text-sm text-muted">
        Any private notes left for you are locked so that only you can open them, with a key that stays on this device. Create it here, then
        download a backup: without it, you can&apos;t open your notes on another device.
      </p>
      {registered && !seed && (
        <p className="mt-2 text-sm text-warn">A key is registered for you, but this browser doesn&apos;t have it. Restore your backup, or create a new key if no notes have been released to you yet.</p>
      )}
      {registered && seed && !matches && localPub && <p className="mt-2 text-sm text-warn">This browser holds a different key from the one registered for you.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!matches && (
          <ActionButton
            onClick={async () => {
              const s = seed ?? (await newSeedHex());
              keys.setHeirSeed(owner, heir.account_id, s);
              const pub = await pubkeyHex(await keypairFromSeedHex(s));
              await call(heir.account_id, "register_heir_key", { owner, x25519_pubkey: pub }, 0n, ROLE_TGAS);
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
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <label className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm hover:bg-accent-soft focus-within:ring-2 focus-within:ring-accent">
        Restore from backup
        <input
          type="file"
          accept="application/json"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const j = JSON.parse(await f.text()) as { x25519_seed_hex?: string };
              if (!j.x25519_seed_hex || !/^[0-9a-f]{64}$/.test(j.x25519_seed_hex)) throw new Error("no key");
              keys.setHeirSeed(owner, heir, j.x25519_seed_hex);
              setResult({ ok: true, text: "Key restored." });
            } catch {
              setResult({ ok: false, text: "That file isn't an Inheirit key backup." });
            }
          }}
        />
      </label>
      {result && <span className={`text-xs ${result.ok ? "text-accent" : "text-danger"}`}>{result.text}</span>}
    </span>
  );
}

function NotesStep({ owner, will, heir }: { owner: string; will: Will; heir: string }) {
  const ownerName = useOwnerName(owner);
  const { data: released } = usePoll(() => view<Released[]>("get_released_notes", { owner, heir }), 15_000, [owner, heir]);
  const [opened, setOpened] = useState<Record<number, string>>({});
  const waiting = will.sealed_notes.filter((n) => n.heir === heir && !(released ?? []).some((r) => r.note_id === n.id));
  return (
    <Step n={5} title="Private notes left for you">
      {(released ?? []).length === 0 && waiting.length === 0 && <p className="text-sm text-muted">There are no private notes for you.</p>}
      {waiting.length > 0 && (
        <p className="text-sm text-muted">
          {ownerName} left you {waiting.length === 1 ? "a private note" : `${waiting.length} private notes`} ({waiting.map((n) => `“${n.label}”`).join(", ")}).
          {waiting.length === 1 ? " It" : " They"} will reach you last, after everything else has been handed over, locked so that only your key can
          open {waiting.length === 1 ? "it" : "them"}.
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
                    if (!seed) throw new Error("This browser doesn't have your key. Restore your backup first (step 2).");
                    const text = await openReleased(n.ciphertext, await keypairFromSeedHex(seed)).catch(() => {
                      throw new Error("This note was sealed to a different key than the one in this browser.");
                    });
                    setOpened((o) => ({ ...o, [n.note_id]: text }));
                  }}
                >
                  Open the note
                </ActionButton>
              )}
            </div>
            {opened[n.note_id] && <p className="mt-2 whitespace-pre-wrap rounded bg-accent-soft p-3 text-sm">{opened[n.note_id]}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Notes open here, on your device. What they say is never sent anywhere.</p>
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
      setTurns([...history, { role: "user", content: question }, { role: "assistant", content: r.ok ? r.answer! : "The guide couldn't answer just now. Please try again in a minute." }]);
    } catch (e) {
      setTurns(history);
      setQ(question);
      throw e;
    }
  };
  return (
    <Card title="Questions? Ask the guide" aside={<AiBadge />}>
      <p className="mb-3 text-sm text-muted">
        Ask anything about what happens next. Answers come from a private AI that sees only your own details, never your notes, and take about
        30 seconds. Please never share a seed phrase or password with anyone, here included.
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
          aria-label="Your question" placeholder="What happens next? How do I open a private note?"
          maxLength={1000}
        />
        <ActionButton disabled={!q.trim()} onClick={ask}>
          Ask
        </ActionButton>
      </div>
    </Card>
  );
}
