"use client";
// The account area: a side bar in the style of X. Wide screens: always on the left. Phones: it slides in
// from the header's avatar (or ☰). Profile on top, the screens, Mainnet, then Sign out.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { NewDevice, RestoreAccess } from "@/components/account/access";
import { SignIn } from "@/components/SignIn";
import { Avatar } from "@/components/ui";
import { AccountProvider, isDemoAccount, MENU_EVENT, useAccount } from "@/lib/account";
import { useKeys, useMyAccounts } from "@/lib/hooks";
import { accountLabel, useNames } from "@/lib/names";
import { isSpeedrun } from "@/lib/speedrun";
import { disconnectWallet, walletAccountId } from "@/lib/wallet";

const SCREENS = [
  { href: "/account", label: "Home" },
  { href: "/account/will", label: "My will" },
  { href: "/account/signs", label: "Signs of life" },
  { href: "/account/secrets", label: "Final secrets" },
  { href: "/account/vault", label: "Vault" },
  { href: "/account/activity", label: "Activity" },
  { href: "/account/speedrun", label: "Try a speedrun" },
  { href: "/mainnet", label: "Mainnet" },
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
  const names = useNames();
  const mine = useMyAccounts();
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setMenuOpen((v) => !v);
    window.addEventListener(MENU_EVENT, toggle);
    return () => window.removeEventListener(MENU_EVENT, toggle);
  }, []);
  // Close the phone side bar on navigation and on Escape.
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  if (!owner) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <SignIn onSignedIn={setOwner} />
        {mine.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-muted">Welcome back</h2>
            <div className="flex flex-wrap gap-2">
              {mine.map((a) => (
                <button key={a} type="button" className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-4 hover:bg-accent-soft" onClick={() => setOwner(a)}>
                  <Avatar name={accountLabel(a, names)} />
                  {accountLabel(a, names)}
                </button>
              ))}
            </div>
          </section>
        )}
        <RestoreAccess onRestored={setOwner} />
        <NewDevice onApproved={setOwner} />
      </div>
    );
  }

  const speedrunBanner = isDemoAccount(owner) || (will && isSpeedrun(will));
  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <aside className="hidden lg:block">
        <div className="sticky top-4">
          <SideBar owner={owner} viewing={viewing} onSignOut={() => setOwner("")} />
        </div>
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-line bg-bg p-4 shadow-xl">
            <SideBar owner={owner} viewing={viewing} onSignOut={() => setOwner("")} />
          </div>
        </div>
      )}
      <div className="min-w-0 space-y-6">
        {speedrunBanner && path !== "/account/speedrun" && (
          <Link href="/account/speedrun" className="block rounded-xl bg-accent-soft px-4 py-3 hover:opacity-90">
            {isDemoAccount(owner) ? "Demo account" : "Speedrun on"}: <b>try a speedrun</b>. Watch your will go quiet, release and snap back in minutes. →
          </Link>
        )}
        <main>{children}</main>
      </div>
    </div>
  );
}

function SideBar({ owner, viewing, onSignOut }: { owner: string; viewing: boolean; onSignOut: () => void }) {
  useKeys(); // re-render when the wallet or the key store changes
  const names = useNames();
  const path = usePathname();
  const router = useRouter();
  const name = accountLabel(owner, names);
  const q = viewing ? `?as=${owner}` : "";
  const active = (href: string) => (href === "/account" ? path === "/account" : path.startsWith(href));
  const item = (href: string, label: string) => (
    <Link
      key={href}
      href={href.startsWith("/account") ? href + q : href}
      aria-current={active(href) ? "page" : undefined}
      className={`flex min-h-11 items-center rounded-full px-4 text-lg ${active(href) ? "bg-accent-soft font-semibold text-ink" : "text-muted hover:bg-accent-soft hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  const signOut = async () => {
    if (walletAccountId() === owner) await disconnectWallet().catch(() => {});
    onSignOut();
    router.push("/account");
  };
  return (
    <nav aria-label="Account" className="flex flex-col gap-1">
      {viewing ? (
        <p className="mb-2 px-4 text-sm text-muted">
          Viewing <b className="text-ink">{name}</b>
        </p>
      ) : (
        <Link
          href="/account/profile"
          aria-current={active("/account/profile") ? "page" : undefined}
          className={`mb-2 flex items-center gap-3 rounded-full p-2 pr-4 ${active("/account/profile") ? "bg-accent-soft" : "hover:bg-accent-soft"}`}
        >
          <Avatar name={name} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{name}</span>
            <span className="block text-sm text-muted">Profile</span>
          </span>
        </Link>
      )}
      {SCREENS.filter((s) => !(viewing && s.href === "/account/speedrun")).map((s) => item(s.href, s.label))}
      <button type="button" onClick={signOut} className="mt-2 flex min-h-11 items-center rounded-full px-4 text-left text-lg text-muted hover:bg-danger-soft hover:text-danger">
        {viewing ? "Back to my account" : "Sign out"}
      </button>
    </nav>
  );
}
