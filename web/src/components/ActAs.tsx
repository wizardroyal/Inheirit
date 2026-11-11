"use client";
// Picks which NEAR account (with a key held in this browser) signs on a page.
import Link from "next/link";
import { useKeys } from "@/lib/hooks";
import { accountLabel, useNames } from "@/lib/names";
import { connectWallet } from "@/lib/wallet";
import { ActionButton, inputCls } from "./ui";

export function ActAs({ value, onChange, suggested, label = "Acting as" }: { value: string; onChange: (id: string) => void; suggested?: string[]; label?: string }) {
  const { accounts } = useKeys();
  const names = useNames();
  const options = suggested?.length ? [...suggested.filter((a) => accounts.includes(a)), ...accounts.filter((a) => !suggested.includes(a))] : accounts;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      {options.length ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} max-w-full`}>
          <option value="">choose an account…</option>
          {options.map((a) => (
            <option key={a} value={a}>
              {accountLabel(a, names)}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span>No account in this browser yet.</span>
          <ActionButton tone="quiet" onClick={async () => onChange(await connectWallet())}>
            Connect a wallet
          </ActionButton>
          <span className="text-muted">
            or <Link href="/owner" className="text-accent underline">try with a demo account</Link>
          </span>
        </span>
      )}
    </div>
  );
}

