"use client";
// Money: vaults, deposit and withdraw, fund from another chain, payouts, released so far.
import { ForeignWithdraw, NearVaultActions } from "@/components/account/parts";
import { WillGate } from "@/components/account/home";
import { FundAnywhere, PayoutsPanel } from "@/components/Payouts";
import { Card, short } from "@/components/ui";
import { Vaults } from "@/components/Vaults";
import { Releases } from "@/components/WillParts";
import { useAccount } from "@/lib/account";
import { useAccountLabel } from "@/lib/names";
import { stateName } from "@/lib/will";

export default function MoneyPage() {
  const { refresh, viewing } = useAccount();
  const label = useAccountLabel();
  return (
    <WillGate>
      {(will) => {
        const active = stateName(will.state) === "Active" && !viewing;
        return (
          <div className="space-y-6">
            <h1 className="font-serif text-3xl sm:text-4xl">Money</h1>
            <div className="grid gap-6 lg:grid-cols-2">
              <Vaults owner={will.owner} will={will}>
                {active ? <NearVaultActions owner={will.owner} refresh={refresh} /> : <p className="mt-2 text-sm text-muted">Deposits and withdrawals only at All good.</p>}
                {active && will.foreign_chains.length > 0 && <ForeignWithdraw owner={will.owner} will={will} refresh={refresh} />}
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
              <Card title="Released so far">
                <Releases will={will} />
              </Card>
              <Card title="Payouts to heirs">
                <PayoutsPanel owner={will.owner} />
              </Card>
              {active && (
                <Card title="Fund from another chain">
                  <FundAnywhere owner={will.owner} vaults={["Near", ...will.foreign_chains]} />
                </Card>
              )}
            </div>
          </div>
        );
      }}
    </WillGate>
  );
}
