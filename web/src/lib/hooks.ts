"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { agent } from "./agent";
import { BOOST_EVENT, boosted } from "./boost";
import { keys, type Cast } from "./keys";
import { view } from "./near";
import { nextStepIn, type Will } from "./will";

// Polling policy (keeps the agent, FastNEAR and the shared egress IP calm):
// - pauses while the tab is hidden, and fetches at once when it becomes visible again;
// - backs off exponentially after errors (up to 60 s);
// - `ms` may be a function, re-read before each wait (e.g. faster while a countdown is close);
// - for a short while after a user action (boostPolling), every poller fetches now and then every 2 s,
//   so a sign of life or a vote shows up within seconds.
export type Interval = number | (() => number);

const BOOST_INTERVAL_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

/** Runs `fn` now and then on the polling policy above, keeping the last good value and the last error. */
export function usePoll<T>(fn: () => Promise<T>, ms: Interval, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const msRef = useRef(ms);
  msRef.current = ms;
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      setData(await fnRef.current());
      setError(null);
      setLoaded(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let running = false;
    const interval = () => {
      const base = typeof msRef.current === "function" ? msRef.current() : msRef.current;
      return boosted() ? Math.min(base, BOOST_INTERVAL_MS) : base;
    };
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (alive && !document.hidden) timer = setTimeout(tick, delay);
    };
    const tick = async () => {
      if (running || !alive) return;
      running = true;
      const ok = await refresh();
      running = false;
      failures = ok ? 0 : failures + 1;
      schedule(failures ? Math.min(interval() * 2 ** failures, MAX_BACKOFF_MS) : interval());
    };
    const wake = () => {
      if (document.hidden) clearTimeout(timer);
      else tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener(BOOST_EVENT, wake);
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener(BOOST_EVENT, wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, ...deps]);
  return { data, error, loaded, refresh };
}

/** The will from the contract: every 8 s, every 3 s when the next automatic step is under 20 s away. */
export function useWill(owner: string | null | undefined, ms = 8000) {
  const latest = useRef<Will | null>(null);
  return usePoll(
    async () => {
      const w = owner ? await view<Will | null>("get_will", { owner }) : null;
      latest.current = w;
      return w;
    },
    () => {
      const next = latest.current && nextStepIn(latest.current, Math.floor(Date.now() / 1000));
      return next && next.seconds < 20 ? 3000 : ms;
    },
    [owner],
  );
}

/** Everything the agent knows about an owner, in one request shared by every panel on the page. */
export function useOverview(owner: string) {
  return usePoll(() => agent.overview(owner), 8000, [owner]);
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
