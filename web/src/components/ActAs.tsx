"use client";
// Picks which NEAR account (with a key held in this browser) signs on a page.
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import Link from "next/link";
import { useState } from "react";
import { useKeys } from "@/lib/hooks";
import { keys } from "@/lib/keys";
import { accountLabel, useNames } from "@/lib/names";
import { provider } from "@/lib/near";
import { ActionButton, Details, inputCls } from "./ui";

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
        <span>
          No accounts in this browser yet. <Link href="/owner" className="text-accent underline">Sign in on Your will</Link> (a free demo account
          takes a few seconds), or <Link href="/demo" className="text-accent underline">create a demo cast</Link>.
        </span>
      )}
    </div>
  );
}

/** Import a testnet key into this browser. The key must already be a full-access key on the account. */
export function ImportKey() {
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [done, setDone] = useState<string | null>(null);
  return (
    <Details summary="Use your own testnet account (import a key)">
      <div className="space-y-2 font-sans">
        <p>Testnet keys only. The key stays in this browser&apos;s storage. Never paste a mainnet key.</p>
        <input className={`${inputCls} w-full`} placeholder="you.testnet" value={id} onChange={(e) => setId(e.target.value.trim())} />
        <input className={`${inputCls} w-full`} placeholder="ed25519:… secret key" value={secret} onChange={(e) => setSecret(e.target.value.trim())} type="password" />
        <ActionButton
          tone="quiet"
          onClick={async () => {
            const pk = KeyPair.fromString(secret as KeyPairString).getPublicKey().toString();
            const keyList = await provider.viewAccessKeyList(id);
            const k = keyList.keys.find((x) => x.public_key === pk);
            if (!k) throw new Error(`That key doesn't belong to ${id}`);
            keys.addAccount(id, secret);
            setSecret("");
            setDone(`Added ${id}`);
          }}
        >
          Import
        </ActionButton>
        {done && <p className="text-accent">{done}</p>}
      </div>
    </Details>
  );
}
