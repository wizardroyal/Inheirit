"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { keys, type Cast } from "./keys";
import { view } from "./near";
import type { Will } from "./will";

/** Runs `fn` now and every `ms`, keeping the last good value and the last error. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const refresh = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await refresh();
      if (alive) timer = setTimeout(loop, ms);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, refresh, ...deps]);
  return { data, error, loaded, refresh };
}

export function useWill(owner: string | null | undefined, ms = 5000) {
  return usePoll(async () => (owner ? await view<Will | null>("get_will", { owner }) : null), ms, [owner]);
}

/** Seconds since epoch, ticking every second. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function subscribe(cb: () => void) {
  window.addEventListener("inheirit-keys", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("inheirit-keys", cb);
    window.removeEventListener("storage", cb);
  };
}

/** Accounts and demo casts held in this browser; re-renders when they change. */
export function useKeys(): { accounts: string[]; casts: Cast[] } {
  const snap = useSyncExternalStore(
    subscribe,
    () => JSON.stringify([keys.accounts(), keys.casts()]),
    () => "[[],[]]",
  );
  const [accounts, casts] = JSON.parse(snap) as [string[], Cast[]];
  return { accounts, casts };
}
