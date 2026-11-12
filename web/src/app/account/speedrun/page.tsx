"use client";
// Try a speedrun: demo tooling lives here, never on a real account's screens. No will yet: generate a sample.
import { GenerateWill } from "@/components/account/parts";
import { SignsOfLife } from "@/components/SignsOfLife";
import { Speedrun } from "@/components/Speedrun";
import { useAccount } from "@/lib/account";

export default function SpeedrunPage() {
  const { owner, will, loaded, refresh, creating, setCreating, viewing } = useAccount();
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl sm:text-4xl">Try a speedrun</h1>
      <p className="max-w-2xl text-lg text-muted">Your own will, on a clock of minutes instead of months. Pick a scenario, then play every role.</p>
      {!loaded ? (
        <p className="text-muted">Loading…</p>
      ) : !will || creating ? (
        !viewing && <GenerateWill owner={owner} onCreating={setCreating} onCreated={refresh} />
      ) : (
        <>
          <SignsOfLife owner={will.owner} will={will} />
          <Speedrun will={will} refresh={refresh} />
        </>
      )}
    </div>
  );
}
