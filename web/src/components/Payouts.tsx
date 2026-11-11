"use client";
// NEAR Intents in the app (CLAUDE.md §J): heirs choose what they receive (universal payout), payout
// status per slice, fund-from-anywhere, and the mainnet demo payouts made with scripts/mainnet-payout.ts.
// On testnet the agent's 1Click client is SIMULATED (NEAR Intents has no testnet), and every element it
// drives says so.
import { useEffect, useMemo, useState } from "react";
import mainnetPayouts from "@/data/mainnet-payouts.json";
import { agent, type FundQuote, type HeirPayouts, type IntentsToken, type PayoutBatch } from "@/lib/agent";
import { usePoll } from "@/lib/hooks";
import { signRequest } from "@/lib/near";
import { ago } from "@/lib/will";
import { ActionButton, ExtLink, Field, inputCls, Pill, short } from "./ui";

const CHAIN_LABELS: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", sol: "Solana", btc: "Bitcoin" };
const chainLabel = (c: string) => CHAIN_LABELS[c] ?? c;

export function IntentsSimTag() {
  return (
    <span title="NEAR Intents has no testnet: on testnet the 1Click swap is simulated with real prices. Mainnet payouts are listed separately." className="inline-flex">
      <Pill tone="sim">SIMULATED</Pill>
    </span>
  );
}

function readLocal(owner: string, heir: string): HeirPayouts["pref"] {
  try {
    const v = window.localStorage.getItem(`inheirit:payout:${owner}:${heir}`);
    return v ? (JSON.parse(v) as HeirPayouts["pref"]) : null;
  } catch {
    return null;
  }
}

function useTokens() {
  return usePoll(() => agent.intentsTokens(), 300_000, []);
}

/** Heir picks chain, asset and address; signed by the heir (§J.3). */
export function PayoutChoice({ owner, heir, current, onSaved }: { owner: string; heir: string; current: HeirPayouts["pref"]; onSaved: () => void }) {
  const { data } = useTokens();
  const tokens = data?.tokens ?? [];
  // Before the release starts the agent doesn't reveal heirs' choices, so this browser remembers its own.
  // The agent shows addresses masked; this browser's own copy has the full one.
  const local = readLocal(owner, heir);
  const saved = current ? (local && local.assetId === current.assetId ? { ...current, address: local.address } : current) : local;
  const [chain, setChain] = useState(saved?.blockchain ?? "base");
  const [assetId, setAssetId] = useState(saved?.assetId ?? "");
  const [address, setAddress] = useState(saved?.address.includes("…") ? "" : (saved?.address ?? ""));
  const [editing, setEditing] = useState(!saved);
  const chains = useMemo(() => [...new Set(tokens.map((t) => t.blockchain))].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b))), [tokens]);
  const onChain = tokens.filter((t) => t.blockchain === chain).sort((a, b) => a.symbol.localeCompare(b.symbol));
  useEffect(() => {
    if (onChain.length && !onChain.some((t) => t.assetId === assetId)) setAssetId((onChain.find((t) => t.symbol === "USDC") ?? onChain[0]).assetId);
  }, [chain, onChain, assetId]);

  if (data && !data.enabled) return <p className="text-sm text-muted">This agent has NEAR Intents payouts turned off.</p>;
  if (saved && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          You receive <b>{saved.symbol}</b> on <b>{chainLabel(saved.blockchain)}</b> at <span className="font-mono">{short(saved.address, 8)}</span>.
        </span>
        <ActionButton tone="quiet" onClick={async () => setEditing(true)}>
          Change
        </ActionButton>
        {!saved.address.includes("…") && (
          <div className="w-full">
            <LiveQuotes assetId={saved.assetId} recipient={saved.address} chain={saved.blockchain} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_8rem_1fr]">
        <Field label="Chain">
          <select className={inputCls} value={chain} onChange={(e) => setChain(e.target.value)}>
            {chains.map((c) => (
              <option key={c} value={c}>
                {chainLabel(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Asset">
          <select className={inputCls} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {onChain.map((t) => (
              <option key={t.assetId} value={t.assetId}>
                {t.symbol}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Your ${chainLabel(chain)} address`}>
          <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder={chain === "near" ? "you.near" : chain === "sol" ? "Solana address" : "0x…"} />
        </Field>
      </div>
      <ActionButton
        disabled={!assetId || !address}
        onClick={async () => {
          const r = await agent.setPayout(await signRequest(heir, "payout_pref", { owner, blockchain: chain, asset_id: assetId, address }));
          try {
            window.localStorage.setItem(`inheirit:payout:${owner}:${heir}`, JSON.stringify(r.pref));
          } catch {
            // storage unavailable: the agent still has the choice
          }
          setEditing(false);
          onSaved();
        }}
      >
        Save, signed as {heir}
      </ActionButton>
      <p className="text-xs text-muted">
        Before saving, the agent checks that NEAR Intents can actually route to this choice. You can change it until each slice is paid.
      </p>
      <LiveQuotes assetId={assetId} recipient={address} chain={chain} />
    </div>
  );
}

type QuoteSide = { quote: { amountOut: string; amountOutUsd: string; minAmountOut: string; timeEstimate: number } } | { error: string };
interface LiveQuoteResult {
  origin: { symbol: string; amount: number; usd: number };
  destination: { symbol: string; blockchain: string };
  public: QuoteSide;
  confidential: QuoteSide;
  at: string;
}

/**
 * Real 1Click quotes on mainnet for this choice (§13A.2 item 1): dry runs only, so no money moves and no
 * deposit address exists. Public and confidential side by side.
 */
export function LiveQuotes({ assetId, recipient, chain }: { assetId: string; recipient: string; chain: string }) {
  const [result, setResult] = useState<LiveQuoteResult | null>(null);
  const ready = !!assetId && recipient.length > 3;
  return (
    <div className="rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          What $10 of NEAR would get you today <Pill tone="accent">live mainnet quote</Pill> <Pill>quote only</Pill>
        </span>
        <ActionButton
          tone="quiet"
          disabled={!ready}
          onClick={async () => {
            setResult(null);
            const res = await fetch("/api/quote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ destination_asset: assetId, recipient, usd: 10 }),
            });
            const out = await res.json();
            if (!res.ok) throw new Error(out.error ?? `Quote failed (${res.status})`);
            setResult(out);
          }}
        >
          {result ? "Quote again" : "Get live quotes"}
        </ActionButton>
      </div>
      {!ready && <p className="mt-1 text-xs text-muted">Enter your {chainLabel(chain)} address to see real prices.</p>}
      {result && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["Public", result.public, "A normal NEAR Intents swap."],
              ["Confidential", result.confidential, "The same swap with NEAR Intents' confidential handling (\"basic\" mode)."],
            ] as const
          ).map(([title, side, note]) => (
            <div key={title} className="rounded-lg bg-bg p-3">
              <p className="text-xs text-muted">{title}</p>
              {"quote" in side ? (
                <>
                  <p className="mt-1">
                    ≈ <b>{side.quote.amountOut}</b> {result.destination.symbol} on {chainLabel(result.destination.blockchain)}
                  </p>
                  <p className="text-xs text-muted">
                    at least {side.quote.minAmountOut} · about {side.quote.timeEstimate} s
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-warn">{side.error}</p>
              )}
              <p className="mt-1 text-xs text-muted">{note}</p>
            </div>
          ))}
        </div>
      )}
      {result && (
        <p className="mt-2 text-xs text-muted">
          Quoted {new Date(result.at).toLocaleTimeString()} from NEAR Intents (1Click) on mainnet for {result.origin.amount} NEAR. This is a dry run:
          nothing is sent. Your testnet inheritance itself is paid out by the SIMULATED client.
        </p>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  QUOTING: "getting a quote",
  WAITING_ROUTE: "waiting for a route",
  PENDING_DEPOSIT: "quote ready",
  KNOWN_DEPOSIT_TX: "deposit seen",
  INCOMPLETE_DEPOSIT: "deposit incomplete",
  PROCESSING: "swapping",
  SUCCESS: "arrived",
  REFUNDED: "refunded, retrying",
  FAILED: "failed, retrying",
};

function BatchRow({ b }: { b: PayoutBatch }) {
  const tone = b.status === "SUCCESS" ? "accent" : b.status === "REFUNDED" || b.status === "FAILED" ? "warn" : "neutral";
  const amount = b.receivedOut ?? b.expectedOut;
  return (
    <li className="rounded-lg border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {b.mode === "direct" ? (
            <>
              {b.originSymbol} slice{b.slices.length > 1 ? "s" : ""} sent directly (same asset and chain)
            </>
          ) : (
            <>
              ≈ ${b.amountUsd.toFixed(2)} of {b.originSymbol} → {amount ? <b>{amount}</b> : "…"} {b.destSymbol} on {chainLabel(b.destChain)}
            </>
          )}
        </span>
        <Pill tone={tone}>{STATUS_TEXT[b.status] ?? b.status}</Pill>
        {b.stable && <Pill tone="accent">stable value</Pill>}
        {b.simulated && <IntentsSimTag />}
      </div>
      <p className="mt-1 text-xs text-muted">
        {b.slices.length} slice{b.slices.length > 1 ? "s" : ""} (stage {b.slices.map((k) => Number(k.split(":")[1]) + 1).join(", ")}) · {ago(b.updatedAt)}
        {b.depositAddress && !b.simulated && <> · deposit {short(b.depositAddress, 6)}</>}
        {b.destinationTx && (
          <>
            {" "}
            · <ExtLink href={b.destinationTx.explorerUrl}>received tx</ExtLink>
          </>
        )}
        {b.note && <> · {b.note}</>}
        {b.error && b.status !== "SUCCESS" && <> · {b.error}</>}
      </p>
    </li>
  );
}

/** One heir's onward payouts: what arrived, what is on its way, what waits for a choice or a minimum. */
export function HeirPayoutList({ p, minUsd, mine }: { p: HeirPayouts; minUsd: number; mine?: boolean }) {
  const waiting = p.waiting.filter((w) => !w.exhausted);
  const usd = waiting.reduce((s, w) => s + (w.usd ?? 0), 0);
  return (
    <div className="space-y-2">
      {waiting.length > 0 && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {p.pref
            ? `${waiting.length} slice${waiting.length > 1 ? "s" : ""} (≈ $${usd.toFixed(2)}) waiting: payouts under $${minUsd} are combined with the next slice, and whatever is left goes out when the release ends.`
            : mine
              ? `Your inheritance is waiting (${waiting.length} slice${waiting.length > 1 ? "s" : ""}, ≈ $${usd.toFixed(2)}): choose how you'd like to receive it.`
              : `${waiting.length} slice${waiting.length > 1 ? "s" : ""} (≈ $${usd.toFixed(2)}) waiting for this heir to choose how to be paid.`}
        </p>
      )}
      {p.waiting.some((w) => w.exhausted) && <p className="text-xs text-danger">Some slices failed to pay out three times and need a person to look at them.</p>}
      <ul className="space-y-2">
        {[...p.batches].reverse().map((b) => (
          <BatchRow key={b.id} b={b} />
        ))}
      </ul>
    </div>
  );
}

/** All heirs' payouts (owner/demo view); shown once the release has started. */
export function PayoutsPanel({ owner }: { owner: string }) {
  const { data } = usePoll(() => agent.payouts(owner), 6000, [owner]);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  if (!data.started)
    return (
      <p className="text-sm text-muted">
        Nothing released yet. As slices are released, each heir&apos;s share goes on through NEAR Intents to the asset and chain they chose
        {data.value_mode === "stable" ? ", converted to US dollars" : ""}.
      </p>
    );
  return (
    <div className="space-y-4">
      {data.simulated && (
        <p className="text-xs text-muted">
          <IntentsSimTag /> NEAR Intents has no testnet. The testnet slices are real; the swap that takes them on to each heir is simulated with
          live 1Click prices. <a href="/mainnet" className="text-accent underline">Real payouts on mainnet</a>.
        </p>
      )}
      {Object.entries(data.heirs).map(([heir, p]) => (
        <div key={heir}>
          <p className="mb-1 text-sm font-medium">{heir}</p>
          <HeirPayoutList p={p} minUsd={data.min_usd} />
        </div>
      ))}
      <MainnetPayouts />
    </div>
  );
}

type MainnetRecord = {
  at: string;
  link: string | null;
  from: { chain: string; symbol: string; amount: number; tx: string };
  to: { chain: string; symbol: string; amount: string; recipient: string; tx: string | null };
  confidentiality: string;
  status: string;
};

/** Real mainnet payouts made by the human with scripts/mainnet-payout.ts (§J.6). */
export function MainnetPayouts() {
  const records = mainnetPayouts as MainnetRecord[];
  if (!records.length) return null;
  return (
    <div>
      <p className="mb-1 text-sm font-medium">
        On mainnet <Pill tone="accent">real</Pill>
      </p>
      <p className="mb-2 text-xs text-muted">
        The same payout done for real, with small amounts, from our demo vault on Base. Each one was approved by a person before it was sent.
      </p>
      <ul className="space-y-1 text-sm">
        {records.map((r, i) => (
          <li key={i}>
            {r.link && <span className="text-muted">{r.link}: </span>}
            {r.from.amount} {r.from.symbol} on {chainLabel(r.from.chain)} → <b>{r.to.amount}</b> {r.to.symbol} on {chainLabel(r.to.chain)} ({r.status.toLowerCase()}
            {r.confidentiality !== "public" ? `, confidential: ${r.confidentiality}` : ""}) · <ExtLink href={r.from.tx}>deposit</ExtLink>
            {r.to.tx && (
              <>
                {" "}
                · <ExtLink href={r.to.tx}>received</ExtLink>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Fund your will from anywhere (§J.5): deposit from another chain or token into a vault. */
export function FundAnywhere({ owner, vaults }: { owner: string; vaults: ("Near" | "Eth" | "Btc")[] }) {
  const { data } = useTokens();
  const tokens: IntentsToken[] = data?.tokens ?? [];
  const [origin, setOrigin] = useState("");
  const [vault, setVault] = useState<"Near" | "Eth" | "Btc">("Near");
  const [amount, setAmount] = useState("25");
  const [quote, setQuote] = useState<FundQuote | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!origin && tokens.length) setOrigin((tokens.find((t) => t.blockchain === "arb" && t.symbol === "USDC") ?? tokens[0]).assetId);
  }, [tokens, origin]);
  useEffect(() => {
    const addr = quote?.quote.depositAddress;
    if (!addr || !status || status === "SUCCESS" || status === "PENDING_DEPOSIT") return;
    const t = setInterval(async () => setStatus((await agent.intentsStatus(addr)).status), 3000);
    return () => clearInterval(t);
  }, [quote, status]);
  if (data && !data.enabled) return null;
  const VAULT_LABEL = { Near: "NEAR vault", Eth: "ETH vault", Btc: "BTC vault" };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Holding USDC on Arbitrum, SOL or something else? NEAR Intents swaps it into your vault&apos;s asset. You send from your own wallet; the app
        never holds your keys. <IntentsSimTag /> on testnet: no coins actually arrive, so use the demo faucet to fund testnet vaults.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem_9rem]">
        <Field label="Pay with">
          <select className={inputCls} value={origin} onChange={(e) => (setOrigin(e.target.value), setQuote(null))}>
            {tokens.map((t) => (
              <option key={t.assetId} value={t.assetId}>
                {t.symbol} on {chainLabel(t.blockchain)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input className={inputCls} value={amount} onChange={(e) => (setAmount(e.target.value), setQuote(null))} />
        </Field>
        <Field label="Into">
          <select className={inputCls} value={vault} onChange={(e) => (setVault(e.target.value as "Near"), setQuote(null))}>
            {vaults.map((v) => (
              <option key={v} value={v}>
                {VAULT_LABEL[v]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ActionButton
        tone="quiet"
        disabled={!origin || !amount}
        onClick={async () => {
          setStatus(null);
          setQuote(await agent.fundQuote(owner, vault, origin, amount));
        }}
      >
        Get a quote and deposit address
      </ActionButton>
      {quote && (
        <div className="rounded-lg bg-accent-soft p-3">
          <p>
            Send <b>{quote.quote.amountInFormatted} {quote.origin.symbol}</b> on {chainLabel(quote.origin.blockchain)} to{" "}
            <span className="break-all font-mono text-xs">{quote.quote.depositAddress}</span>
          </p>
          <p className="mt-1">
            Your {VAULT_LABEL[quote.vault as "Near"]} receives ≈ <b>{quote.quote.amountOutFormatted}</b> (${Number(quote.quote.amountOutUsd).toFixed(2)}) in about{" "}
            {quote.quote.timeEstimate} s.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {quote.simulated && !status && (
              <ActionButton
                tone="quiet"
                onClick={async () => {
                  await agent.fundSent(quote.quote.depositAddress!);
                  setStatus("KNOWN_DEPOSIT_TX");
                }}
              >
                I&apos;ve sent it (SIMULATED)
              </ActionButton>
            )}
            {status && <Pill tone={status === "SUCCESS" ? "accent" : "neutral"}>{STATUS_TEXT[status] ?? status}</Pill>}
            {quote.simulated && <IntentsSimTag />}
          </div>
        </div>
      )}
    </div>
  );
}
