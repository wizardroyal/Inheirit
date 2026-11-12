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
  return (
    <Card title="Vaults">
      <ul className="space-y-2 text-sm">
        <li className="flex justify-between gap-2">
          <span>NEAR (held by the contract)</span>
          <span>{formatNear(will.near_balance)} NEAR</span>
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
                <span>{c === "Eth" ? "Sepolia ETH" : "BTC testnet4"}</span>
                <span title={stale ? "Last known balance; the latest lookup failed and will be retried" : undefined}>
                  {ok ? (c === "Eth" ? `${(Number(v.balance) / 1e18).toFixed(5)} ETH` : `${v.balance} sats`) : v ? "balance unavailable, retrying" : "…"}
                  {stale && <span className="text-muted"> (last known)</span>}
                </span>
              </div>
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
          <Details summary="How to fund the Sepolia and BTC vaults">
            <div className="font-sans">
              Chain Signatures addresses (path heirloom/&lt;owner&gt;/&lt;chain&gt;), signable only during the release or for your withdrawal. Fund
              them from any faucet or the button below; empty vaults are skipped.
            </div>
          </Details>
        </div>
      )}
      <FaucetButton owner={owner} will={will} />
      {error && <p className="text-xs text-danger">{error}</p>}
      {will.foreign_chains.length === 0 && <p className="mt-2 text-xs text-muted">This will holds NEAR only: no Sepolia or Bitcoin vault.</p>}
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
