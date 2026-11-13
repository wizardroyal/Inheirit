"use client";
// Home: where the will stands, how strong it is, the one next step, the latest thing that happened.
// Without a will: demo accounts get the front door (generate one, or set it up), everyone else the
// account setup and then a link to My will, where wills are created.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FinishSetup, RecentLine, StatusHero } from "@/components/account/home";
import { FrontDoor } from "@/components/account/parts";
import { AccountSetup } from "@/components/account/setup";
import { NextStep, StrengthBar } from "@/components/account/strength";
import { Card, NoWill, Skeleton } from "@/components/ui";
import { isDemoAccount, useAccount } from "@/lib/account";
import { useProfile } from "@/lib/profile";

export default function HomePage() {
  const { owner, will, loaded, refresh, creating, setCreating, viewing } = useAccount();
  const [profile] = useProfile(owner);
  const [settingUp, setSettingUp] = useState(false);
  const router = useRouter();
  if (!loaded) return <Skeleton />;
  if (!will && viewing) return <NoWill owner={owner} />;
  if (!will || creating) {
    const toWill = () => router.push("/account/will");
    if (settingUp || (!isDemoAccount(owner) && !profile.setupDone)) return <AccountSetup owner={owner} onDone={toWill} />;
    if (isDemoAccount(owner)) return <FrontDoor owner={owner} onCreating={setCreating} onCreated={refresh} onSetUp={() => (profile.setupDone ? toWill() : setSettingUp(true))} />;
    return (
      <Card>
        <p className="text-lg">You don&apos;t have a will yet.</p>
        <Link href="/account/will" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-accent px-5 py-2 font-medium text-accent-ink hover:opacity-90">
          Create your will
        </Link>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <FinishSetup will={will} />
      <StatusHero will={will} refresh={refresh} />
      <StrengthBar will={will} />
      {!viewing && <NextStep will={will} />}
      <RecentLine owner={owner} />
    </div>
  );
}
