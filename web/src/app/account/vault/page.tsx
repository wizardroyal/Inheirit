"use client";
// Vault: name, holdings, deposit and withdraw, fund from another chain, payouts, released so far.
import { WillGate } from "@/components/account/home";
import { VaultSection } from "@/components/account/vault";
import { PayoutsPanel } from "@/components/Payouts";
import { Card } from "@/components/ui";
import { Releases } from "@/components/WillParts";

export default function VaultPage() {
  return (
    <WillGate>
      {(will) => (
        <div className="space-y-6">
          <h1 className="font-serif text-3xl sm:text-4xl">Vault</h1>
          <div className="mx-auto max-w-3xl space-y-6">
            <VaultSection will={will} />
            <Card title="Payouts to heirs">
              <PayoutsPanel owner={will.owner} />
            </Card>
            <Card title="Released so far">
              <Releases will={will} />
            </Card>
          </div>
        </div>
      )}
    </WillGate>
  );
}
