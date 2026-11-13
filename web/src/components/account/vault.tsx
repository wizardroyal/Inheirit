"use client";
// The vault (one per account): its name, holdings with a total in dollars, and Deposit / Withdraw pop-ups.
// Deposit: pick a token and a chain; the vault's own chains show the vault address (NEAR is deposited from
// the owner's account), anything else goes through NEAR Intents (SIMULATED on testnet). Withdrawals also
// work while the will is paused.
import { useRef, useState } from "react";
import { toUnits } from "@/components/account/parts";
import { chainLabel, IntentsSimTag } from "@/components/Payouts";
import { useAccount } from "@/lib/account";
import { agent, type FundQuote, type IntentsToken } from "@/lib/agent";
import { fundFromFaucet } from "@/lib/demo";
import { usePoll } from "@/lib/hooks";
import { useAccountLabel } from "@/lib/names";
import { call, formatNear, nearToYocto } from "@/lib/near";
import { useProfile } from "@/lib/profile";
import { stateName, type Will } from "@/lib/will";
import { Icon } from "../icons";
import { ActionButton, Card, ErrorNote, Field, GearButton, inputCls, Modal, short } from "../ui";

export function VaultName({ owner }: { owner: string }) {
  const [profile, save] = useProfile(owner);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile.vaultName ?? "");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="font-serif text-3xl sm:text-4xl">{profile.vaultName || "Vault"}</h1>
      <GearButton open={open} label="Rename the vault" onClick={() => (setName(profile.vaultName ?? ""), setOpen(!open))} />
      {open && (
        <span className="flex w-full flex-wrap items-end gap-2">
          <Field label="Vault name">
            <input className={inputCls} maxLength={64} placeholder="e.g. Family savings" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ActionButton onClick={async () => (await save({ vaultName: name.trim() }), setOpen(false))}>Save</ActionButton>
        </span>
      )}
    </div>
  );
}

type Chain = "Near" | "Eth" | "Btc";

/** Balances per chain (last good value kept through a failed lookup) and live prices. */
function useHoldings(will: Will) {
  const { data } = usePoll(() => agent.vaults(will.owner), 30_000, [will.owner]);
  const { data: tokens } = usePoll(() => agent.intentsTokens().catch(() => null), 10 * 60_000, []);
  const last = useRef<Partial<Record<"Eth" | "Btc", { address: string; balance: string }>>>({});
  const price = (symbol: string, chain: string) => tokens?.tokens.find((t) => t.symbol === symbol && t.blockchain === chain)?.price ?? 0;
  const rows: { chain: Chain; label: string; amount: number | null; unit: string; usd: number; address?: string }[] = [
    { chain: "Near", label: "NEAR", amount: Number(formatNear(will.near_balance)), unit: "NEAR", usd: Number(formatNear(will.near_balance)) * price("wNEAR", "near") },
  ];
  for (const c of will.foreign_chains) {
    const fresh = data?.[c];
    if (fresh && "address" in fresh) last.current[c] = fresh;
    const v = last.current[c];
    const amount = v ? Number(v.balance) / (c === "Eth" ? 1e18 : 1e8) : null;
    const address = v?.address ?? (fresh && "vault" in fresh ? fresh.vault : undefined);
    rows.push({ chain: c, label: c === "Eth" ? "Ethereum" : "Bitcoin", amount, unit: c === "Eth" ? "ETH" : "BTC", usd: (amount ?? 0) * (c === "Eth" ? price("ETH", "eth") : price("BTC", "btc")), address });
  }
  return { rows, tokens: tokens?.enabled ? tokens.tokens : [], total: rows.reduce((s, r) => s + r.usd, 0) };
}

export function VaultSection({ will }: { will: Will }) {
  const { viewing } = useAccount();
  const label = useAccountLabel();
  const { rows, tokens, total } = useHoldings(will);
  const [modal, setModal] = useState<"deposit" | "withdraw" | null>(null);
  const s = stateName(will.state);
  const open = (s === "Active" || s === "Paused") && !viewing;
  const btn = "inline-flex min-h-11 items-center gap-2 rounded-lg px-5 py-2 font-medium";
  return (
    <div className="space-y-6">
      {!viewing && <VaultName owner={will.owner} />}
      <Card title="Holdings">
        <p className="font-serif text-4xl">≈ ${total.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</p>
        <ul className="mt-4 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.chain} className="flex items-center justify-between gap-3 py-3 text-lg">
              <span>{r.label}</span>
              <span className="tabular-nums">{r.amount === null ? "…" : `${+r.amount.toFixed(r.chain === "Btc" ? 8 : 5)} ${r.unit}`}</span>
            </li>
          ))}
        </ul>
        {will.pending_withdrawals.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {will.pending_withdrawals.map((w) => (
              <li key={w.id}>Withdrawal to {w.chain === "Near" ? label(w.to) : short(w.to, 8)}: on its way</li>
            ))}
          </ul>
        )}
        {open ? (
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={`${btn} bg-accent text-accent-ink hover:opacity-90`} onClick={() => setModal("deposit")}>
              <Icon name="plus" className="h-4 w-4" /> Deposit
            </button>
            <button type="button" className={`${btn} border border-line hover:bg-accent-soft`} onClick={() => setModal("withdraw")}>
              Withdraw
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Deposits and withdrawals only at All good or while paused.</p>
        )}
      </Card>
      {modal === "deposit" && <DepositModal will={will} rows={rows} tokens={tokens} onClose={() => setModal(null)} />}
      {modal === "withdraw" && <WithdrawModal will={will} onClose={() => setModal(null)} />}
    </div>
  );
}

type Route = { key: string; chain: string; kind: "near" | "vault"; vault?: "Eth" | "Btc" } | { key: string; chain: string; kind: "intents"; assetId: string };

/** Token → chains it can come from: the vault's own chains first, then NEAR Intents routes into the NEAR vault. */
function routes(will: Will, tokens: IntentsToken[]): Map<string, Route[]> {
  const m = new Map<string, Route[]>();
  const add = (sym: string, r: Route) => m.set(sym, [...(m.get(sym) ?? []), r]);
  add("NEAR", { key: "near", chain: "NEAR", kind: "near" });
  if (will.foreign_chains.includes("Eth")) add("ETH", { key: "eth-vault", chain: "Ethereum", kind: "vault", vault: "Eth" });
  if (will.foreign_chains.includes("Btc")) add("BTC", { key: "btc-vault", chain: "Bitcoin", kind: "vault", vault: "Btc" });
  for (const t of tokens) {
    if (t.symbol === "wNEAR" || (t.symbol === "ETH" && t.blockchain === "eth") || (t.symbol === "BTC" && t.blockchain === "btc")) continue;
    add(t.symbol, { key: t.assetId, chain: chainLabel(t.blockchain), kind: "intents", assetId: t.assetId });
  }
  return m;
}

function DepositModal({ will, rows, tokens, onClose }: { will: Will; rows: ReturnType<typeof useHoldings>["rows"]; tokens: IntentsToken[]; onClose: () => void }) {
  const { refresh } = useAccount();
  const all = routes(will, tokens);
  const [symbol, setSymbol] = useState("NEAR");
  const [routeKey, setRouteKey] = useState(all.get("NEAR")![0].key);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<FundQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const list = all.get(symbol) ?? [];
  const route = list.find((r) => r.key === routeKey) ?? list[0];
  const vaultRow = route?.kind === "vault" ? rows.find((r) => r.chain === route.vault) : undefined;
  const reset = () => (setQuote(null), setErr(null), setCopied(false));
  return (
    <Modal title="Deposit" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Token">
          <select className={inputCls} value={symbol} onChange={(e) => (setSymbol(e.target.value), setRouteKey(all.get(e.target.value)![0].key), reset())}>
            {[...all.keys()].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Chain">
          <select className={inputCls} value={route?.key} onChange={(e) => (setRouteKey(e.target.value), reset())}>
            {list.map((r) => (
              <option key={r.key} value={r.key}>
                {r.chain}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5 space-y-3">
        {route?.kind === "near" && (
          <>
            <Field label="Amount (NEAR)">
              <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.1" />
            </Field>
            <ActionButton disabled={!(Number(amount) > 0)} onClick={async () => (await call(will.owner, "deposit_near", {}, nearToYocto(amount)), refresh(), onClose())}>
              Deposit from my account
            </ActionButton>
          </>
        )}
        {route?.kind === "vault" && !vaultRow?.address && <p className="text-muted">Loading the address…</p>}
        {route?.kind === "vault" && vaultRow?.address && (
          <>
            <p className="text-sm text-muted">Your deposit address ({route.vault === "Eth" ? "Ethereum Sepolia testnet" : "Bitcoin testnet4"})</p>
            <p className="break-all rounded-lg border border-line bg-bg p-3 font-mono text-sm">{vaultRow.address}</p>
            <button type="button" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line hover:bg-accent-soft" onClick={() => navigator.clipboard.writeText(vaultRow.address!).then(() => setCopied(true))}>
              <Icon name="copy" className="h-4 w-4" /> {copied ? "Copied" : "Copy address"}
            </button>
            <button type="button" className="min-h-11 text-sm text-accent underline" onClick={() => fundFromFaucet(will.owner, (m) => setLog((l) => [...l, m]))}>
              Or fill empty vaults with free test coins
            </button>
            {log.length > 0 && <p className="text-sm text-muted">{log[log.length - 1]}</p>}
          </>
        )}
        {route?.kind === "intents" && (
          <>
            <Field label={`Amount (${symbol})`}>
              <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => (setAmount(e.target.value), setQuote(null))} placeholder="25" />
            </Field>
            {!quote ? (
              <ActionButton
                disabled={!(Number(amount) > 0)}
                onClick={async () => {
                  setErr(null);
                  try {
                    setQuote(await agent.fundQuote(will.owner, "Near", route.assetId, amount));
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Get deposit address
              </ActionButton>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Your deposit address · arrives as ≈ {quote.quote.amountOutFormatted} NEAR in about {quote.quote.timeEstimate} s
                </p>
                <p className="break-all rounded-lg border border-line bg-bg p-3 font-mono text-sm">{quote.quote.depositAddress}</p>
                {quote.simulated && (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <IntentsSimTag /> NEAR Intents has no testnet: don&apos;t send anything here.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {err && <ErrorNote>{err}</ErrorNote>}
      </div>
    </Modal>
  );
}

function WithdrawModal({ will, onClose }: { will: Will; onClose: () => void }) {
  const { refresh } = useAccount();
  const [chain, setChain] = useState<Chain>("Near");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const unit = chain === "Near" ? "NEAR" : chain === "Eth" ? "ETH" : "BTC";
  return (
    <Modal title="Withdraw" onClose={onClose}>
      <div className="space-y-3">
        <Field label="From">
          <select className={inputCls} value={chain} onChange={(e) => (setChain(e.target.value as Chain), setErr(null))}>
            <option value="Near">NEAR</option>
            {will.foreign_chains.map((c) => (
              <option key={c} value={c}>
                {c === "Eth" ? "Ethereum" : "Bitcoin"}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Amount (${unit})`}>
          <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {chain !== "Near" && (
          <Field label="To your address">
            <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={chain === "Eth" ? "0x…" : "tb1…"} />
          </Field>
        )}
        {chain === "Near" && <p className="text-sm text-muted">Goes back to your own account.</p>}
        {err && <ErrorNote>{err}</ErrorNote>}
        <ActionButton
          disabled={!(Number(amount) > 0) || (chain !== "Near" && !to)}
          onClick={async () => {
            setErr(null);
            try {
              const units = chain === "Near" ? nearToYocto(amount) : toUnits(amount, chain === "Eth" ? 18 : 8);
              await call(will.owner, "request_withdrawal", { chain, to: chain === "Near" ? will.owner : to, amount: units.toString() }, 0n, 100n);
              refresh();
              onClose();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Withdraw
        </ActionButton>
      </div>
    </Modal>
  );
}
