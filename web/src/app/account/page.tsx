"use client";
// Home: where the will stands, how strong it is, the one next step, the latest thing that happened.
import { CreateWill, LowBalance } from "@/components/account/parts";
import { RecentLine, StatusHero } from "@/components/account/home";
import { NextStep, StrengthBar } from "@/components/account/strength";
import { NoWill } from "@/components/ui";
import { useAccount } from "@/lib/account";

export default function HomePage() {
  const { owner, will, loaded, refresh, creating, setCreating, viewing } = useAccount();
  if (!loaded) return <p className="text-muted">Loading…</p>;
  if (!will && viewing) return <NoWill owner={owner} />;
  if (!will || creating)
    return (
      <div className="space-y-6">
        {!creating && <LowBalance owner={owner} />}
        <CreateWill owner={owner} onCreating={setCreating} onCreated={refresh} />
      </div>
    );
  return (
    <div className="space-y-6">
      <StatusHero will={will} refresh={refresh} />
      <StrengthBar will={will} />
      {!viewing && <NextStep will={will} />}
      <RecentLine owner={owner} />
    </div>
  );
}
