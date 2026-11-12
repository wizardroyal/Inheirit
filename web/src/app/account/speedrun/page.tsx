"use client";
// Try a speedrun: demo tooling lives here, never on a real account's screens.
import { WillGate } from "@/components/account/home";
import { SignsOfLife } from "@/components/SignsOfLife";
import { Speedrun } from "@/components/Speedrun";
import { useAccount } from "@/lib/account";

export default function SpeedrunPage() {
  const { refresh } = useAccount();
  return (
    <WillGate>
      {(will) => (
        <div className="space-y-6">
          <h1 className="font-serif text-3xl sm:text-4xl">Try a speedrun</h1>
          <p className="max-w-2xl text-lg text-muted">Your own will, on a clock of minutes instead of months. Pick a scenario, then play every role.</p>
          <SignsOfLife owner={will.owner} will={will} />
          <Speedrun will={will} refresh={refresh} />
        </div>
      )}
    </WillGate>
  );
}
