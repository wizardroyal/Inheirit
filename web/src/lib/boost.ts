// "Something just happened": for a short while after a user action, every poller fetches now and then
// every 2 s, so a sign of life or a vote shows up within seconds. Polls stay slow the rest of the time.
export const BOOST_EVENT = "inheirit-boost";
let boostUntil = 0;
const recent = new Map<string, { at: number; value: Promise<unknown> }>();

export function boostPolling(forMs = 20_000) {
  if (typeof window === "undefined") return;
  boostUntil = Date.now() + forMs;
  recent.clear(); // reads shared from before the write are stale now
  window.dispatchEvent(new Event(BOOST_EVENT));
}

export const boosted = () => Date.now() < boostUntil;

/** Shares identical in-flight or very recent reads between components (one request instead of N). */
export function shared<T>(key: string, fn: () => Promise<T>, ttlMs = 1500): Promise<T> {
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  recent.set(key, { at: Date.now(), value });
  value.catch(() => recent.delete(key));
  if (recent.size > 200) recent.clear();
  return value;
}
