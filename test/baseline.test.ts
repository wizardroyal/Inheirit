import { describe, expect, it } from "vitest";
import { computeBaseline, DEFAULT_QUIET_S, everyPhrase, fetchBaseline, MAX_QUIET_S, MIN_QUIET_S } from "../src/liveness/baseline";

const DAY = 86_400;
const NOW = 2_000_000_000;
const every = (gapDays: number, n: number) => Array.from({ length: n }, (_, i) => NOW - i * gapDays * DAY);

describe("baseline", () => {
  it("median gap and a suggestion of 3× it, in whole days", () => {
    const b = computeBaseline(every(3, 20), NOW);
    expect(b.medianGapS).toBe(3 * DAY);
    expect(b.suggestedQuietS).toBe(30 * DAY); // 3 × 3 days, raised to the 30-day minimum
    expect(computeBaseline(every(15, 6), NOW).suggestedQuietS).toBe(45 * DAY);
    expect(b.sessions).toBe(20);
  });

  it("the median ignores a single long trip", () => {
    const times = [...every(2, 15), NOW - 80 * DAY];
    expect(computeBaseline(times, NOW).medianGapS).toBe(2 * DAY);
  });

  it("never suggests under 30 days, and caps rare owners at 180", () => {
    expect(computeBaseline(every(0.5, 40), NOW).suggestedQuietS).toBe(MIN_QUIET_S);
    expect(computeBaseline(every(20, 5), NOW).suggestedQuietS).toBe(60 * DAY);
    // 5 sessions in 90 days keep the median gap ≤ 22.5 days, so the cap is a guard, never hit with real data.
    expect(computeBaseline(every(22, 5), NOW).suggestedQuietS).toBeLessThanOrEqual(MAX_QUIET_S);
  });

  it("a burst of transactions within an hour is one session", () => {
    const burst = (t: number) => [t, t + 60, t + 600, t + 3000];
    const times = every(4, 10).flatMap(burst);
    const b = computeBaseline(times, NOW + 3600);
    expect(b.sessions).toBe(10);
    expect(b.medianGapS).toBe(4 * DAY);
  });

  it("too little history: no claim about what's usual, default 30 days", () => {
    const b = computeBaseline(every(3, 4), NOW);
    expect(b.medianGapS).toBeNull();
    expect(b.suggestedQuietS).toBe(DEFAULT_QUIET_S);
  });

  it("only the last 90 days count, and future times are dropped", () => {
    const old = Array.from({ length: 30 }, (_, i) => NOW - (100 + i) * DAY);
    expect(computeBaseline([...old, NOW + 10 * DAY], NOW).sessions).toBe(0);
  });

  it("phrases the gap for people", () => {
    expect(everyPhrase(3600)).toBe("several times a day");
    expect(everyPhrase(8 * 3600)).toBe("every 8 hours");
    expect(everyPhrase(3 * DAY)).toBe("every 3 days");
  });

  it("merges NEAR and Sepolia history and skips a source that fails", async () => {
    const nearTimes = every(4, 6).map((t) => ({ is_any_signer: true, tx_block_timestamp: `${BigInt(t) * 1_000_000_000n}` }));
    const sepTimes = every(4, 6).map((t) => ({ timestamp: new Date((t - 2 * DAY) * 1000).toISOString() }));
    const fake = (async (url: string) => {
      if (String(url).includes("fastnear")) return new Response(JSON.stringify({ account_txs: [...nearTimes, { is_any_signer: false, tx_block_timestamp: "1" }] }));
      if (String(url).includes("0xbad")) return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ items: sepTimes }));
    }) as typeof fetch;
    const b = await fetchBaseline(["alice.testnet"], ["0xabc", "0xbad"], NOW, fake);
    expect(b.sources.sort()).toEqual(["NEAR", "Sepolia"]);
    expect(b.sessions).toBe(12);
    expect(b.medianGapS).toBe(2 * DAY);
  });
});
