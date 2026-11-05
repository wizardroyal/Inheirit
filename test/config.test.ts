import { describe, expect, it } from "vitest";
import { rpcEndpoints } from "../src/config";

describe("rpcEndpoints", () => {
  it("splits a comma-separated list", () => {
    expect(rpcEndpoints(" https://a.example , https://b.example ")).toEqual([{ url: "https://a.example" }, { url: "https://b.example" }]);
  });

  it("moves an apiKey query parameter into a bearer header", () => {
    const [e] = rpcEndpoints("https://test.rpc.fastnear.com?apiKey=secret123");
    expect(e.url).not.toContain("secret123");
    expect(e.url).toBe("https://test.rpc.fastnear.com/");
    expect(e.headers).toEqual({ Authorization: "Bearer secret123" });
  });

  it("keeps other query parameters", () => {
    const [e] = rpcEndpoints("https://rpc.example/path?x=1&apiKey=k");
    expect(e.url).toBe("https://rpc.example/path?x=1");
  });
});
