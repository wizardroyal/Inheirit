"use client";
// Signs of life: one ranked list; tap a row to connect, manage or learn why it isn't available yet.
import { WillGate } from "@/components/account/home";
import { SignsList } from "@/components/account/signs";
import { QuietSetting } from "@/components/account/will";
import { useAccount } from "@/lib/account";

export default function SignsPage() {
  const { owner, viewing } = useAccount();
  return (
    <WillGate>
      {(will) => (
        <div className="space-y-6">
          <h1 className="font-serif text-3xl sm:text-4xl">Signs of life</h1>
          <p className="max-w-2xl text-lg text-muted">Normal activity keeps your will at All good. You never check in.</p>
          <SignsList owner={owner} viewing={viewing} />
          {!viewing && <QuietSetting will={will} />}
        </div>
      )}
    </WillGate>
  );
}
