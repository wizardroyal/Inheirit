import { describe, expect, it } from "vitest";
import { dustSafeTargets, splitByShares, stageAmount } from "../src/executor/amounts";

describe("stageAmount", () => {
  const stages = [10, 30, 60];
  it("non-last stages are a percent of the snapshot", () => {
    expect(stageAmount(1000n, stages, 0, 1000n)).toBe(100n);
    expect(stageAmount(1000n, stages, 1, 880n)).toBe(300n);
  });
  it("the last stage releases everything left", () => {
    expect(stageAmount(1000n, stages, 2, 577n)).toBe(577n);
  });
  it("never exceeds what is left", () => {
    expect(stageAmount(1000n, stages, 1, 250n)).toBe(250n);
  });
  it("rejects a stage that does not exist", () => {
    expect(() => stageAmount(1000n, stages, 3, 1n)).toThrow();
  });
});

describe("splitByShares", () => {
  it("splits by percent and gives dust to the last paid heir", () => {
    expect(splitByShares(101n, { h1: 50, h2: 50 })).toEqual(new Map([["h1", 50n], ["h2", 51n]]));
  });
  it("skips heirs with 0%", () => {
    expect(splitByShares(100n, { h1: 0, h2: 100 })).toEqual(new Map([["h2", 100n]]));
  });
  it("rejects shares not summing to 100", () => {
    expect(() => splitByShares(100n, { h1: 60 })).toThrow();
  });
});

import { splitWeighted, stageTargets } from "../src/executor/amounts";

describe("splitWeighted", () => {
  it("splits by any weights with dust to the last", () => {
    expect(splitWeighted(10n, { a: 1, b: 2 })).toEqual(new Map([["a", 3n], ["b", 7n]]));
  });
});

describe("stageTargets", () => {
  it("non-last stage pays each unpaid heir its percent of gross; fees stay in the vault", () => {
    expect(stageTargets({ isLast: false, gross: 1000n, unpaidShares: { h1: 80, h2: 20 } }, 50n)).toEqual(
      new Map([["h1", 800n], ["h2", 200n]]),
    );
  });
  it("non-last stage after a partial failure pays only the rest, same amounts", () => {
    expect(stageTargets({ isLast: false, gross: 1000n, unpaidShares: { h2: 20 } }, 25n)).toEqual(new Map([["h2", 200n]]));
  });
  it("last stage sweeps balance minus fees by share", () => {
    expect(stageTargets({ isLast: true, gross: 1050n, unpaidShares: { h1: 80, h2: 20 } }, 50n)).toEqual(
      new Map([["h1", 800n], ["h2", 200n]]),
    );
  });
  it("last stage refuses when fees exceed the balance", () => {
    expect(() => stageTargets({ isLast: true, gross: 10n, unpaidShares: { h1: 100 } }, 50n)).toThrow(/does not cover fees/);
  });
});

describe("dustSafeTargets (Bitcoin)", () => {
  const fee = (n: number) => BigInt(100 + 31 * n);
  it("defers a non-last slice below dust instead of failing the stage", () => {
    const t = dustSafeTargets({ isLast: false, gross: 2000n, unpaidShares: { a: 80, b: 20 } }, fee, 546n);
    expect([...t]).toEqual([["a", 1600n]]);
  });
  it("the final sweep gives dust-sized shares to heirs whose share clears dust", () => {
    const t = dustSafeTargets({ isLast: true, gross: 3000n, unpaidShares: { a: 90, b: 10 } }, fee, 546n);
    expect([...t]).toEqual([["a", 3000n - fee(1)]]);
  });
  it("a vault holding only dust pays nobody, so the stage can complete", () => {
    expect(dustSafeTargets({ isLast: true, gross: 700n, unpaidShares: { a: 50, b: 50 } }, fee, 546n).size).toBe(0);
  });
  it("still refuses (and retries) when a real balance can't cover fees right now", () => {
    expect(() => dustSafeTargets({ isLast: true, gross: 1500n, unpaidShares: { a: 100 } }, () => 1200n, 546n)).toThrow(/does not cover fees/);
  });
  it("leaves normal stages unchanged", () => {
    const t = dustSafeTargets({ isLast: false, gross: 20000n, unpaidShares: { a: 50, b: 50 } }, fee, 546n);
    expect([...t]).toEqual([["a", 10000n], ["b", 10000n]]);
  });
});
