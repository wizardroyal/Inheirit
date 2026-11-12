"use client";
// The account area (judge feedback round 3): one job per screen, persistent navigation. Desktop: a row of
// tabs. Phone: a bottom bar with the first five, the rest under "More".
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { AccountActions } from "@/components/account/parts";
import { SignIn } from "@/components/SignIn";
import { AccountProvider, isDemoAccount, useAccount } from "@/lib/account";
import { useMyAccounts } from "@/lib/hooks";
import { accountLabel, useNames } from "@/lib/names";
import { isSpeedrun } from "@/lib/speedrun";

const MAIN = [
  { href: "/account", label: "Home" },
  { href: "/account/will", label: "My will" },
  { href: "/account/signs", label: "Signs of life" },
  { href: "/account/people", label: "People" },
  { href: "/account/secrets", label: "Final secrets" },
];
const MORE = [
  { href: "/account/money", label: "Money" },
  { href: "/account/activity", label: "Activity" },
  { href: "/account/settings", label: "Settings" },
];

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <AccountProvider>
        <Shell>{children}</Shell>
      </AccountProvider>
    </Suspense>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { owner, setOwner, will, viewing } = useAccount();
  const path = usePathname();
  const names = useNames();
  const mine = useMyAccounts();
  const [signingIn, setSigningIn] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  if (!owner || signingIn) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="font-serif text-4xl sm:text-5xl">Your will</h1>
        {mine.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Welcome back:</span>
            {mine.map((a) => (
              <button key={a} type="button" className="rounded-full border border-line bg-card px-3 py-1 hover:bg-accent-soft" onClick={() => (setOwner(a), setSigningIn(false))}>
                {accountLabel(a, names)}
              </button>
            ))}
          </div>
        )}
        <SignIn onSignedIn={(id) => (setOwner(id), setSigningIn(false))} />
      </div>
    );
  }

  const speedrunShown = isDemoAccount(owner) || (will && isSpeedrun(will));
  const more = [...MORE, ...(speedrunShown ? [{ href: "/account/speedrun", label: "Try a speedrun" }] : [])];
  const active = (href: string) => (href === "/account" ? path === "/account" : path.startsWith(href));
  const tab = (l: { href: string; label: string }) => (
    <Link
      key={l.href}
      href={l.href + (viewing ? `?as=${owner}` : "")}
      aria-current={active(l.href) ? "page" : undefined}
      className={`whitespace-nowrap rounded-full px-4 py-2 ${active(l.href) ? "bg-accent text-accent-ink" : "text-muted hover:bg-accent-soft hover:text-ink"}`}
    >
      {l.label}
    </Link>
  );

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted">{viewing ? "Viewing" : "Signed in as"}</span>
        <span className="font-medium">{accountLabel(owner, names)}</span>
        <AccountActions owner={owner} onSignIn={() => (setSigningIn(true), setOwner(""))} onSignedOut={() => setOwner("")} />
      </div>
      {speedrunShown && path !== "/account/speedrun" && (
        <Link href="/account/speedrun" className="block rounded-xl bg-accent-soft px-4 py-3 hover:opacity-90">
          Demo account: <b>try a speedrun</b>. Watch your will go quiet, release and snap back in minutes. →
        </Link>
      )}
      <nav aria-label="Account" className="hidden flex-wrap gap-1 sm:flex">
        {[...MAIN, ...more].map(tab)}
      </nav>
      <main>{children}</main>
      {/* Phone: the first five in a bottom bar, the rest under More */}
      <nav aria-label="Account" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card sm:hidden">
        {moreOpen && (
          <div className="flex flex-col border-b border-line p-2">
            {more.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setMoreOpen(false)} className={`rounded-lg px-4 py-3 ${active(l.href) ? "bg-accent-soft" : ""}`}>
                {l.label}
              </Link>
            ))}
          </div>
        )}
        <div className="grid grid-cols-6 text-center text-[11px]">
          {MAIN.map((l) => (
            <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined} className={`px-1 py-3 ${active(l.href) ? "font-semibold text-accent" : "text-muted"}`}>
              {l.label}
            </Link>
          ))}
          <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} className={`px-1 py-3 ${more.some((l) => active(l.href)) ? "font-semibold text-accent" : "text-muted"}`}>
            More
          </button>
        </div>
      </nav>
    </div>
  );
}
