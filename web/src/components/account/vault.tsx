"use client";
// The vault (one per account): its name, holdings with a total in dollars, and Deposit / Withdraw pop-ups.
// Deposit: pick a chain; its test token and an address to copy follow. Withdrawals also work while the will
// is paused.
import { useRef, useState } from "react";
import { toUnits } from "@/components/account/parts";
import { useAccount } from "@/lib/account";
import { agent } from "@/lib/agent";
import { fundFromFaucet } from "@/lib/demo";
import { usePoll } from "@/lib/hooks";
import { useAccountLabel } from "@/lib/names";
import { balanceOf, call, formatNear, nearToYocto } from "@/lib/near";
import { useProfile } from "@/lib/profile";
import { stateName, type Will } from "@/lib/will";
import { Icon } from "../icons";
import { ActionButton, Card, ConfirmButton, ErrorNote, Field, GearButton, inputCls, Modal, short } from "../ui";

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
  return { rows, total: rows.reduce((s, r) => s + r.usd, 0) };
}

export function VaultSection({ will }: { will: Will }) {
  const { viewing, refresh } = useAccount();
  const label = useAccountLabel();
  const { rows, total } = useHoldings(will);
  const [modal, setModal] = useState<"deposit" | "withdraw" | null>(null);
  const s = stateName(will.state);
  const open = (s === "Active" || s === "Paused") && !viewing;
  const btn = "inline-flex min-h-11 items-center gap-2 rounded-lg px-5 py-2 font-medium";
  return (
    <div className="space-y-6">
      {!viewing && <VaultName owner={will.owner} />}
      <Card title="Holdings">
        <p className="font-serif text-4xl">
          ≈ ${total.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} <span className="font-sans text-sm text-muted">at mainnet prices</span>
        </p>
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
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>Withdrawal to {w.chain === "Near" ? label(w.to) : short(w.to, 8)}: on its way</span>
                {!viewing && <ConfirmButton label="Cancel" question="Cancel this withdrawal? If it was already sent, it still arrives." onConfirm={() => call(will.owner, "cancel_withdrawal", { id: w.id }).then(refresh)} />}
              </li>
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
        <p className="mt-4 text-sm text-muted">
          Nobody holds this vault&apos;s keys, not you and not us: NEAR&apos;s signing network signs for it only to pay your heirs or your own withdrawals. Your recovery key controls your account, which can withdraw everything at any time.
        </p>
      </Card>
      {modal === "deposit" && <DepositModal will={will} rows={rows} onClose={() => setModal(null)} />}
      {modal === "withdraw" && <WithdrawModal will={will} rows={rows} onClose={() => setModal(null)} />}
    </div>
  );
}

/** One address to copy, with a copy button. */
function AddressBox({ address, note }: { address: string; note: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{note}</p>
      <p className="break-all rounded-lg border border-line bg-bg p-3 font-mono text-sm">{address}</p>
      <button
        type="button"
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line hover:bg-accent-soft"
        onClick={() => navigator.clipboard.writeText(address).then(() => setCopied(true), () => setCopied(false))}
      >
        <Icon name="copy" className="h-4 w-4" /> {copied ? "Copied" : copied === false ? "Select the address above to copy it" : "Copy address"}
      </button>
    </div>
  );
}

/**
 * Deposit: pick a chain; its test token and an address to copy follow. Ethereum and Bitcoin go straight
 * to the vault's own address. NEAR is held by the will contract, which can't tell whose a plain transfer
 * is, so NEAR goes to your account first and "Move into the vault" deposits it.
 */
function DepositModal({ will, rows, onClose }: { will: Will; rows: ReturnType<typeof useHoldings>["rows"]; onClose: () => void }) {
  const { refresh } = useAccount();
  const [chain, setChain] = useState<Chain>("Near");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const { data: own } = usePoll(() => balanceOf(will.owner).then((b) => formatNear(b.toString())).catch(() => null), 10_000, [will.owner]);
  const row = rows.find((r) => r.chain === chain);
  const TOKEN: Record<Chain, string> = { Near: "NEAR (testnet)", Eth: "ETH (Sepolia testnet)", Btc: "BTC (testnet)" };
  return (
    <Modal title="Deposit" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Chain">
          <select className={inputCls} value={chain} onChange={(e) => (setChain(e.target.value as Chain), setErr(null))}>
            <option value="Near">NEAR</option>
            {will.foreign_chains.map((c) => (
              <option key={c} value={c}>
                {c === "Eth" ? "Ethereum" : "Bitcoin"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Token">
          <select className={inputCls} value={chain} disabled aria-readonly>
            <option value={chain}>{TOKEN[chain]}</option>
          </select>
        </Field>
      </div>
      <div className="mt-5 space-y-4">
        {chain === "Near" ? (
          <>
            <AddressBox address={will.owner} note={`Send testnet NEAR to your account${own != null ? ` (holds ${own} NEAR)` : ""}, then move it into the vault.`} />
            <Field label="Move into the vault (NEAR)">
              <span className="flex gap-2">
                <input className={`${inputCls} min-w-0 flex-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.1" />
                <ActionButton
                  disabled={!(Number(amount) > 0)}
                  onClick={async () => {
                    setErr(null);
                    try {
                      await call(will.owner, "deposit_near", {}, nearToYocto(amount));
                      refresh();
                      onClose();
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Move
                </ActionButton>
              </span>
            </Field>
          </>
        ) : row?.address ? (
          <>
            <AddressBox address={row.address} note={`Send only ${TOKEN[chain]} to this vault address.`} />
            <button type="button" className="min-h-11 text-sm text-accent underline" onClick={() => fundFromFaucet(will.owner, (m) => setLog((l) => [...l, m])).catch((e) => setLog((l) => [...l, e instanceof Error ? e.message : String(e)]))}>
              Or get free test coins for empty vaults
            </button>
            {log.length > 0 && <p className="text-sm text-muted">{log[log.length - 1]}</p>}
          </>
        ) : (
          <p className="text-muted">Loading the address… (the agent may be restarting; try again in a minute)</p>
        )}
        {err && <ErrorNote>{err}</ErrorNote>}
      </div>
    </Modal>
  );
}

function WithdrawModal({ will, rows, onClose }: { will: Will; rows: ReturnType<typeof useHoldings>["rows"]; onClose: () => void }) {
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
            // A foreign withdrawal the agent can't send stays pending (and blocks Close), so check it here.
            const have = rows.find((r) => r.chain === chain)?.amount;
            if (have !== null && have !== undefined && Number(amount) > have) return setErr(`The vault holds ${have} ${unit}.`);
            if (chain === "Eth" && !/^0x[0-9a-fA-F]{40}$/.test(to)) return setErr("An Ethereum address starts with 0x and has 40 more characters.");
            if (chain === "Btc" && !/^(tb1|[mn2])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(to)) return setErr("Give a Bitcoin testnet address (tb1…).");
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
