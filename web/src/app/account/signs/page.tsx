"use client";
// Signs of life: every source with its weight and status; connect more.
import { WatchSettings } from "@/components/account/parts";
import { WillGate } from "@/components/account/home";
import { Card } from "@/components/ui";
import { SignalList } from "@/components/WillParts";
import { useAccount } from "@/lib/account";

export default function SignsPage() {
  const { owner, viewing } = useAccount();
  return (
    <WillGate>
      {(will) => (
        <div className="space-y-6">
          <h1 className="font-serif text-3xl sm:text-4xl">Signs of life</h1>
          <p className="max-w-2xl text-lg text-muted">Normal activity keeps your will at All good. You never check in. Strong signals count alone; weak ones need a second source.</p>
          <Card>
            <SignalList owner={owner} will={will} />
            {!viewing && <WatchSettings owner={owner} />}
          </Card>
        </div>
      )}
    </WillGate>
  );
}
