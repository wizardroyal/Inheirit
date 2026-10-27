import { describe, expect, it } from "vitest";
import { type Observation, scoreAlive } from "../src/liveness/score";

const now = new Date("2026-11-01T12:00:00Z");
const h = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000);
const obs = (source: Observation["source"], hoursAgo: number, trustWeight: number, simulated = false): Observation => ({
  source,
  at: h(hoursAgo),
  trustWeight,
  simulated,
});

describe("scoreAlive", () => {
  it("returns null with no signals", () => {
    expect(scoreAlive([], now)).toBeNull();
  });
  it("a strong signal counts on its own", () => {
    expect(scoreAlive([obs("near_onchain", 5, 0.9)], now)).toEqual({ at: h(5), basis: ["near_onchain"] });
  });
  it("picks the most recent strong signal", () => {
    const v = scoreAlive([obs("near_onchain", 5, 0.9), obs("phone_heartbeat", 1, 0.9)], now);
    expect(v?.at).toEqual(h(1));
  });
  it("a single weak signal does not count", () => {
    expect(scoreAlive([obs("x", 1, 0.4, true)], now)).toBeNull();
  });
  it("two weak sources agreeing within the window count, from the older one", () => {
    const v = scoreAlive([obs("x", 1, 0.4, true), obs("instagram", 3, 0.4, true)], now);
    expect(v).toEqual({ at: h(3), basis: ["x", "instagram"] });
  });
  it("two weak sources far apart do not count", () => {
    expect(scoreAlive([obs("x", 1, 0.4), obs("github", 40, 0.5)], now)).toBeNull();
  });
  it("ignores timestamps too far in the future", () => {
    expect(scoreAlive([{ ...obs("near_onchain", 0, 0.9), at: new Date(now.getTime() + 3600_000) }], now)).toBeNull();
  });
  it("clamps small future skew to now", () => {
    const v = scoreAlive([{ ...obs("near_onchain", 0, 0.9), at: new Date(now.getTime() + 10_000) }], now);
    expect(v?.at).toEqual(now);
  });
  it("a weak pair newer than a strong signal wins", () => {
    const v = scoreAlive([obs("near_onchain", 10, 0.9), obs("x", 2, 0.4), obs("github", 1, 0.5)], now);
    expect(v?.at).toEqual(h(2));
  });
});
