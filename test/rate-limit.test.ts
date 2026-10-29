import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/auth/rate-limit";

describe("RateLimiter", () => {
  it("limits each key and the total within a window, then resets", () => {
    let t = 0;
    const l = new RateLimiter({ perKey: 2, global: 3, windowMs: 1000 }, () => t);
    expect(l.take("a")).toBe(0);
    expect(l.take("a")).toBe(0);
    expect(l.take("a")).toBeGreaterThan(0); // per key
    expect(l.take("b")).toBe(0);
    expect(l.take("c")).toBe(1000); // global
    t = 1000;
    expect(l.take("a")).toBe(0);
  });
});
