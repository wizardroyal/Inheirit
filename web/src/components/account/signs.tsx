"use client";
// Signs of life: one list, strongest first. Tap a row to connect it, see it and remove it, or read why it
// isn't available yet. Only times are ever read, never content.
import { useState } from "react";
import { agent } from "@/lib/agent";
import { ago, SOURCE_LABELS } from "@/lib/will";
import { signRequest } from "@/lib/near";
import { TelegramLink } from "../TelegramLink";
import { ConfirmButton, ErrorNote, Field, inputCls } from "../ui";
import { SOURCES, strength } from "../WillParts";
import { useSignalStatus } from "./strength";

/** Wallets added from this device (the agent never reveals them, so only this device can list them). */
const ADDED = "inheirit:added-sources";
type Added = { near: string[]; evm: string[] };
export function addedFor(owner: string): Added {
  try {
    return (JSON.parse(localStorage.getItem(ADDED) ?? "{}") as Record<string, Added>)[owner] ?? { near: [], evm: [] };
  } catch {
    return { near: [], evm: [] };
  }
}
export function saveAdded(owner: string, a: Added) {
  try {
    const all = JSON.parse(localStorage.getItem(ADDED) ?? "{}") as Record<string, Added>;
    all[owner] = a;
    localStorage.setItem(ADDED, JSON.stringify(all));
  } catch {
    // storage blocked
  }
}

/** Which chain an address belongs to, from its format. */
export function detectChain(a: string): "near" | "evm" | "btc" | null {
  const s = a.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return "evm";
  if (/^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(s)) return "btc";
  if (/^[0-9a-f]{64}$/.test(s) || /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)+$/.test(s)) return "near";
  return null;
}

const COMING: Record<string, string> = {
  google_calendar: "Reading when you last used Google needs Google's app review, which takes weeks. Coming soon.",
  gmail: "Reading when you last used Google needs Google's app review, which takes weeks. Coming soon.",
  x: "X charges for reading activity through its API. Coming soon.",
  instagram: "Instagram doesn't let apps read a person's activity times. Coming soon.",
  tiktok: "TikTok's API isn't open for this yet. Coming soon.",
  facebook: "Facebook doesn't let apps read a person's activity times. Coming soon.",
  linkedin: "LinkedIn's API is closed to this. Coming soon.",
};

export function SignsList({ owner, viewing }: { owner: string; viewing: boolean }) {
  const { overview, watching, evmCount, connected } = useSignalStatus(owner);
  const [open, setOpen] = useState<string | null>(null);
  const [added, setAdded] = useState<Added>(() => addedFor(owner));
  const [wallet, setWallet] = useState("");
  const [github, setGithub] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const obs = overview?.signals?.observations ?? {};
  const rows = [...SOURCES].sort((a, b) => b.weight - a.weight || Number(a.simulated) - Number(b.simulated));

  const send = async (data: Record<string, unknown>) => agent.registerOwner(await signRequest(owner, "register_owner", data));
  const pushList = async (next: Added, kind: "near" | "evm") => {
    await send(kind === "near" ? { near_accounts: next.near } : { evm_addresses: next.evm });
    saveAdded(owner, next);
    setAdded(next);
  };
  const addWallet = async () => {
    setMsg(null);
    const kind = detectChain(wallet);
    if (!kind) return setMsg({ ok: false, text: "That doesn't look like a NEAR, Ethereum or Bitcoin address." });
    if (kind === "btc") return setMsg({ ok: false, text: "Bitcoin wallets aren't read as signs of life yet. NEAR and Ethereum are." });
    const a = kind === "near" ? wallet.trim().toLowerCase() : wallet.trim();
    if (kind === "near" && a === owner) return setMsg({ ok: false, text: "Your own account already counts." });
    const next = { ...added, [kind]: [...new Set([...added[kind], a])].slice(0, 5) };
    try {
      await pushList(next, kind);
      setWallet("");
      setMsg({ ok: true, text: `Added your ${kind === "near" ? "NEAR" : "Ethereum"} wallet. The agent checks every 15 seconds.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const status = (source: string) => {
    if (COMING[source]) return obs[source as keyof typeof obs] ? "simulated" : "coming soon";
    return connected[source] ? "connected" : "not connected";
  };
  const walletField = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field label="Add a wallet (NEAR, Ethereum or Bitcoin address)">
        <input className={`${inputCls} min-w-0`} value={wallet} onChange={(e) => (setWallet(e.target.value), setMsg(null))} placeholder="you.near or 0x…" />
      </Field>
      <button type="button" disabled={!wallet.trim()} className="min-h-11 rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-50" onClick={addWallet}>
        Add wallet
      </button>
    </div>
  );
  const addedChips = (kind: "near" | "evm") =>
    added[kind].length > 0 ? (
      <ul className="space-y-2">
        {added[kind].map((v) => (
          <li key={v} className="flex flex-wrap items-center justify-between gap-2">
            <span className="break-all">{kind === "evm" ? `${v.slice(0, 6)}…${v.slice(-4)}` : v}</span>
            <ConfirmButton label="Remove" question="Stop watching this wallet?" onConfirm={() => pushList({ ...added, [kind]: added[kind].filter((x) => x !== v) }, kind)} />
          </li>
        ))}
      </ul>
    ) : null;

  const detail = (source: string) => {
    if (COMING[source]) return <p>{COMING[source]}</p>;
    switch (source) {
      case "near_onchain":
        return (
          <div className="space-y-3">
            <p>Your own account always counts{watching.near_extra ? `, plus ${watching.near_extra} more wallet${watching.near_extra > 1 ? "s" : ""}` : ""}. Mainnet .near wallets are read too, read-only.</p>
            {addedChips("near")}
            {!viewing && walletField}
          </div>
        );
      case "evm_onchain":
        return (
          <div className="space-y-3">
            <p>{evmCount ? `Watching ${evmCount} Ethereum wallet${evmCount > 1 ? "s" : ""}.` : "Add an Ethereum wallet you use (not the vault)."}</p>
            {addedChips("evm")}
            {evmCount > added.evm.length && <p className="text-sm text-muted">Added sources are private; remove them from the device you added them on.</p>}
            {!viewing && walletField}
          </div>
        );
      case "phone_heartbeat":
        return (
          <p>
            {connected.phone_heartbeat ? "Opened on your phone. Every opening counts." : "Add the heartbeat app to your phone's home screen; just opening it is a strong sign of life."}{" "}
            <a href="/heartbeat" target="_blank" rel="noreferrer" className="text-accent underline">
              {connected.phone_heartbeat ? "Open it" : "Install heartbeat app"}
            </a>
          </p>
        );
      case "telegram":
        return connected.telegram ? <p>Linked. Any message you send the bot counts, and checks reach you there first.</p> : !viewing && <TelegramLink account={owner} purpose="Checks reach you there first; any reply counts." />;
      case "github":
        return connected.github ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>Connected. Public activity times only; weak on its own.</p>
            {!viewing && <ConfirmButton label="Remove" question="Stop watching GitHub?" onConfirm={() => send({ github: "" }).then(() => setMsg({ ok: true, text: "Removed." }))} />}
          </div>
        ) : (
          !viewing && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="GitHub username">
                <input className={`${inputCls} min-w-0`} value={github} onChange={(e) => setGithub(e.target.value.trim())} />
              </Field>
              <button
                type="button"
                disabled={!github}
                className="min-h-11 rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-50"
                onClick={async () => (await send({ github }), setGithub(""), setMsg({ ok: true, text: "GitHub connected." }))}
              >
                Connect
              </button>
            </div>
          )
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {rows.map((s) => {
          const st = status(s.source);
          const at = obs[s.source as keyof typeof obs]?.at;
          const isOpen = open === s.source;
          return (
            <li key={s.source}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => (setOpen(isOpen ? null : s.source), setMsg(null))}
                className="flex min-h-14 w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left hover:bg-accent-soft"
              >
                <span className="flex items-center gap-3 text-lg">
                  {SOURCE_LABELS[s.source]}
                  <span className="rounded-full border border-line px-2 py-0.5 text-sm text-muted">{strength(s.weight).label}</span>
                </span>
                <span className={st === "connected" ? "text-accent" : "text-muted"}>
                  {st === "connected" ? `● connected${at ? ` · ${ago(at)}` : ""}` : st}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-line px-5 py-4">
                  {detail(s.source)}
                  {msg && (msg.ok ? <p className="text-accent">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote>)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">Strong and medium signals count alone; weak ones need a second source within 24 hours. Only times are read, never content.</p>
    </div>
  );
}
