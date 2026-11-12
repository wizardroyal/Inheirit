"use client";
// The signed-in account for the /account screens: which owner, their will, and sign-in/out. The account
// used last reopens on the next visit; `?as=<owner>` views someone else's will read-only.
import { useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useWill } from "./hooks";
import { ensureName, rememberOwner } from "./names";
import { canSign } from "./near";
import type { Will } from "./will";

const CURRENT = "inheirit:current-owner";

interface Account {
  owner: string;
  setOwner: (id: string) => void;
  will: Will | null;
  loaded: boolean;
  refresh: () => void;
  /** True while a will is being created (keep the creation screen until every step is done). */
  creating: boolean;
  setCreating: (b: boolean) => void;
  /** Viewing someone else's will (no key here): read-only. */
  viewing: boolean;
}

const Ctx = createContext<Account | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const as = params.get("as") ?? "";
  const [owner, setOwnerState] = useState(as);
  useEffect(() => {
    if (as) return setOwnerState(as);
    try {
      setOwnerState(window.localStorage.getItem(CURRENT) ?? "");
    } catch {
      // storage blocked: sign in again
    }
  }, [as]);
  const setOwner = (id: string) => {
    setOwnerState(id);
    try {
      if (id) window.localStorage.setItem(CURRENT, id);
      else window.localStorage.removeItem(CURRENT);
    } catch {
      // storage blocked
    }
  };
  const { data: will, loaded, refresh } = useWill(owner || null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (owner && canSign(owner)) {
      ensureName(owner);
      rememberOwner(owner);
    }
  }, [owner]);
  return (
    <Ctx.Provider value={{ owner, setOwner, will: will ?? null, loaded, refresh, creating, setCreating, viewing: !!owner && !canSign(owner) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAccount(): Account {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAccount outside AccountProvider");
  return a;
}

/** Accounts made by "Try with a demo account". */
export const isDemoAccount = (id: string) => /^demo-[0-9a-f]+\.inheirit-users\.testnet$/.test(id);
