"use client";
import { useRef, useState, type ReactNode } from "react";
import { ActionButton, Card, Details, ExtLink } from "@/components/ui";
import { agent } from "@/lib/agent";
import { explorer } from "@/lib/config";
import { fundFromFaucet } from "@/lib/demo";
import { usePoll } from "@/lib/hooks";
import { formatNear } from "@/lib/near";
import { stateName, type Will } from "@/lib/will";

export function ProgressLog({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="mt-3 space-y-0.5 font-mono text-xs text-muted">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

/** The will's three vaults: NEAR held by the contract, plus the Chain Signatures addresses on Sepolia and Bitcoin testnet4. */
export function Vaults({ owner, will, children }: { owner: string; will: Will; children?: ReactNode }) {
  const { data, error } = usePoll(() => agent.vaults(owner), 30_000, [owner]);
  // A failed balance lookup (explorer API hiccup) keeps showing the last good value instead of flickering to "unavailable".
  const lastGood = useRef<Partial<Record<"Eth" | "Btc", { address: string; balance: string }>>>({});
  // Live prices (NEAR Intents token list) for "≈ $" next to each holding.
  const { data: tokens } = usePoll(() => agent.intentsTokens().catch(() => null), 10 * 60_000, []);
  const price = (symbol: string, chain: string) => tokens?.tokens.find((t) => t.symbol === symbol && t.blockchain === chain)?.price;
  const usd = (amount: number, p?: number) => (p && amount > 0 ? <span className="text-muted"> ≈ ${(amount * p).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> : null);
  return (
    <Card title="Holdings">
      <ul className="space-y-3 text-lg">
        <li className="flex flex-wrap justify-between gap-2">
          <span>NEAR</span>
          <span>
            {formatNear(will.near_balance)} NEAR{usd(Number(formatNear(will.near_balance)), price("wNEAR", "near"))}
          </span>
        </li>
        {will.foreign_chains.map((c) => {
          const fresh = data?.[c];
          if (fresh && "address" in fresh) lastGood.current[c] = fresh;
          const v = fresh && "address" in fresh ? fresh : (lastGood.current[c] ?? fresh);
          const ok = v && "address" in v;
          const stale = ok && fresh && !("address" in fresh);
          return (
            <li key={c} className="space-y-0.5">
              <div className="flex justify-between gap-2">
                <span>{c === "Eth" ? "Ethereum" : "Bitcoin"}</span>
                <span title={stale ? "Last known balance; the latest lookup failed and will be retried" : undefined}>
                  {ok ? (c === "Eth" ? `${+(Number(v.balance) / 1e18).toFixed(5)} ETH` : `${v.balance} sats`) : v ? "balance unavailable, retrying" : "…"}
                  {ok && (c === "Eth" ? usd(Number(v.balance) / 1e18, price("ETH", "eth")) : usd(Number(v.balance) / 1e8, price("BTC", "btc")))}
                  {stale && <span className="text-muted"> (last known)</span>}
                </span>
              </div>
              {ok && Number(v.balance) === 0 && <p className="text-xs text-muted">Empty: this will moves NEAR only. Fund it below or from any faucet.</p>}
              {(ok ? v.address : v?.vault) && (
                <div className="break-all text-xs text-muted">
                  <AddressLink chain={c} address={ok ? v.address : v!.vault!} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {children}
      {will.foreign_chains.length > 0 && (
        <div className="mt-3">
          <Details summary="How to fund the Ethereum and Bitcoin vaults">
            <div className="font-sans">
              Chain Signatures addresses (path heirloom/&lt;owner&gt;/&lt;chain&gt;), signable only during the release or for your withdrawal. Fund
              them from any faucet or the button below; empty vaults are skipped.
            </div>
          </Details>
        </div>
      )}
      <FaucetButton owner={owner} will={will} />
      {error && <p className="text-xs text-danger">{error}</p>}
      {will.foreign_chains.length === 0 && <p className="mt-2 text-xs text-muted">This will holds NEAR only: no Ethereum or Bitcoin vault.</p>}
    </Card>
  );
}

function AddressLink({ chain, address }: { chain: "Eth" | "Btc"; address: string }) {
  return <ExtLink href={chain === "Eth" ? explorer.ethAddress(address) : explorer.btcAddress(address)}>{address}</ExtLink>;
}

function FaucetButton({ owner, will }: { owner: string; will: Will }) {
  const { data: info } = usePoll(() => agent.faucetInfo(), 60_000);
  const [log, setLog] = useState<string[]>([]);
  if (!info?.enabled || will.foreign_chains.length === 0 || stateName(will.state) !== "Active") return null;
  return (
    <div className="mt-3">
      <ActionButton tone="quiet" onClick={() => fundFromFaucet(owner, (m) => setLog((l) => [...l, m]))}>
        Fund empty vaults from the demo faucet
      </ActionButton>
      <ProgressLog lines={log} />
    </div>
  );
}
