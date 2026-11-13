"use client";
// The site header's right side: Heartbeat, then the signed-in account's round avatar (or ☰ when signed
// out). On the account screens it opens the side bar on a phone; elsewhere it goes to the account.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CURRENT_OWNER_KEY, MENU_EVENT, OWNER_EVENT } from "@/lib/account";
import { accountLabel, useNames } from "@/lib/names";
import { Avatar } from "./ui";

export function HeaderNav() {
  const path = usePathname();
  const router = useRouter();
  const names = useNames();
  const [owner, setOwner] = useState("");
  useEffect(() => {
    const read = () => {
      try {
        setOwner(window.localStorage.getItem(CURRENT_OWNER_KEY) ?? "");
      } catch {
        setOwner("");
      }
    };
    read();
    window.addEventListener(OWNER_EVENT, read);
    window.addEventListener("storage", read);
    return () => (window.removeEventListener(OWNER_EVENT, read), window.removeEventListener("storage", read));
  }, []);
  const open = () => {
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    if (!owner || !path.startsWith("/account")) router.push("/account");
    // Wide screens show the side bar already: the avatar goes to Profile.
    else if (wide) router.push("/account/profile");
    else window.dispatchEvent(new Event(MENU_EVENT));
  };
  const name = owner ? accountLabel(owner, names) : "";
  return (
    <div className="flex items-center gap-4">
      <Link href="/heartbeat" className="flex min-h-11 items-center text-sm text-muted hover:text-ink">
        Heartbeat
      </Link>
      <button type="button" onClick={open} aria-label={owner ? `${name}: open menu` : "Open menu"} title={owner ? name : "Menu"} className="rounded-full">
        {owner ? (
          <Avatar name={name} />
        ) : (
          <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-xl hover:bg-accent-soft">
            ☰
          </span>
        )}
      </button>
    </div>
  );
}
