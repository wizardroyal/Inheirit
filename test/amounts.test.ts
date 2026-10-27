import { describe, expect, it } from "vitest";
import { splitByShares, stageAmount } from "../src/executor/amounts";

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
