"use client";
// The vault (one per account): its name, holdings per chain, deposit and withdraw, funding from another
// chain. Used by the Vault tab and by Profile. Withdrawals also work while the will is paused.
import { useState } from "react";
import { ForeignWithdraw, NearVaultActions } from "@/components/account/parts";
import { FundAnywhere } from "@/components/Payouts";
import { Vaults } from "@/components/Vaults";
import { useAccount } from "@/lib/account";
import { useAccountLabel } from "@/lib/names";
import { useProfile } from "@/lib/profile";
import { stateName, type Will } from "@/lib/will";
import { ActionButton, Card, Field, GearButton, inputCls, short } from "../ui";

export function VaultName({ owner }: { owner: string }) {
  const [profile, save] = useProfile(owner);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile.vaultName ?? "");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-serif text-2xl">{profile.vaultName || "My vault"}</h2>
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

export function VaultSection({ will, withFunding = true }: { will: Will; withFunding?: boolean }) {
  const { refresh, viewing } = useAccount();
  const label = useAccountLabel();
  const s = stateName(will.state);
  const open = (s === "Active" || s === "Paused") && !viewing;
  return (
    <div className="space-y-6">
      {!viewing && <VaultName owner={will.owner} />}
      <Vaults owner={will.owner} will={will}>
        {open ? <NearVaultActions owner={will.owner} refresh={refresh} /> : <p className="mt-2 text-sm text-muted">Deposits and withdrawals only at All good or while paused.</p>}
        {open && will.foreign_chains.length > 0 && <ForeignWithdraw owner={will.owner} will={will} refresh={refresh} />}
        {will.pending_withdrawals.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {will.pending_withdrawals.map((w) => (
              <li key={w.id}>
                Withdrawal to {w.chain === "Near" ? label(w.to) : short(w.to, 8)}: the agent is sending it
              </li>
            ))}
          </ul>
        )}
      </Vaults>
      {withFunding && open && (
        <Card title="Fund from another chain">
          <FundAnywhere owner={will.owner} vaults={["Near", ...will.foreign_chains]} />
        </Card>
      )}
    </div>
  );
}
