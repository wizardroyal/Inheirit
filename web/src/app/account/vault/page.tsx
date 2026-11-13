"use client";
// Vault: name, holdings with deposit and withdraw, then payouts to heirs.
import { WillGate } from "@/components/account/home";
import { VaultSection } from "@/components/account/vault";
import { PayoutsPanel } from "@/components/Payouts";
import { Card } from "@/components/ui";

export default function VaultPage() {
  return (
    <WillGate>
      {(will) => (
        <div className="mx-auto max-w-3xl space-y-6">
          <VaultSection will={will} />
          <Card title="Payouts to heirs">
            <PayoutsPanel owner={will.owner} />
          </Card>
        </div>
      )}
    </WillGate>
  );
}
