import { describe, expect, it } from "vitest";
import { type Observation, scoreAlive, scoreBeforeChecks } from "../src/liveness/score";

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

describe("scoreBeforeChecks (a lone weak signal postpones checks, bounded)", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const day = 86_400;
  const obs = (source: Observation["source"], at: Date, trustWeight: number): Observation => ({ source, at, trustWeight, simulated: false });

  it("a weak signal after the last strong one, within one quiet period, counts", () => {
    const v = scoreBeforeChecks([obs("near_onchain", ago(20), 0.9), obs("github", ago(2), 0.5)], now, 30 * day);
    expect(v?.basis).toEqual(["github"]);
    expect(v?.at.getTime()).toBe(ago(2).getTime());
  });
  it("but not beyond one quiet period after the strong signal", () => {
    const v = scoreBeforeChecks([obs("near_onchain", ago(40), 0.9), obs("github", ago(2), 0.5)], now, 30 * day);
    expect(v?.basis).toEqual(["near_onchain"]);
  });
  it("and never without any strong signal", () => {
    expect(scoreBeforeChecks([obs("github", ago(2), 0.5)], now, 30 * day)).toBeNull();
  });
  it("scoreAlive itself still ignores a lone weak signal", () => {
    expect(scoreAlive([obs("near_onchain", ago(20), 0.9), obs("github", ago(2), 0.5)], now)?.basis).toEqual(["near_onchain"]);
  });
});
