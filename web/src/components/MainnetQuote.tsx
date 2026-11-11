"use client";
// A live NEAR Intents quote on mainnet, on the /mainnet page: pick where an heir is paid, see the real
// price for $10 of NEAR, public and confidential. A dry run: nothing is sent.
import { useState } from "react";
import { LiveQuotes } from "./Payouts";
import { inputCls } from "./ui";

// Example recipients, only so a quote can be priced: dry quotes never send anything to them.
const CHOICES = [
  { label: "USDC on Base", blockchain: "base", symbol: "USDC", example: "0x8c3a2b1f4e9d7c6b5a4f3e2d1c0b9a8f7e6d5c4b" },
  { label: "USDC on Arbitrum", blockchain: "arb", symbol: "USDC", example: "0x8c3a2b1f4e9d7c6b5a4f3e2d1c0b9a8f7e6d5c4b" },
  { label: "SOL on Solana", blockchain: "sol", symbol: "SOL", example: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV" },
];

export function MainnetQuote() {
  const [i, setI] = useState(0);
  const [address, setAddress] = useState(CHOICES[0].example);
  const c = CHOICES[i];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">An heir is paid in</span>
          <select
            className={inputCls}
            value={i}
            onChange={(e) => {
              const k = Number(e.target.value);
              setI(k);
              setAddress(CHOICES[k].example);
            }}
          >
            {CHOICES.map((x, k) => (
              <option key={x.label} value={k}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium">To the address (an example; nothing is sent)</span>
          <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value.trim())} />
        </label>
      </div>
      <LiveQuotes key={i} recipient={address} chain={c.blockchain} symbol={c.symbol} />
    </div>
  );
}
