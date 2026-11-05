import { JsonRpcProvider } from "@near-js/providers";
import { describe, expect, it } from "vitest";
import { isTransportError, nearRpcProvider } from "../src/near-rpc";

// Two endpoints whose `fetch` is stubbed per host
function twoEndpoints(responders: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const host = new URL(String(input instanceof Request ? input.url : input)).host;
    calls.push(host);
    return responders[host]();
  }) as typeof fetch;
  const rpc = nearRpcProvider([{ url: "https://a.example" }, { url: "https://b.example" }]);
  return { rpc, calls, restore: () => (globalThis.fetch = orig) };
}

const viewAccountMissing = () =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT", info: { requested_account_id: "x.testnet" } }, code: -32000, message: "Server error", data: "account x.testnet does not exist while viewing" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
const okAccount = () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { amount: "1", locked: "0", code_hash: "11111111111111111111111111111111", storage_usage: 1, storage_paid_at: 0, block_height: 1, block_hash: "x" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("nearRpcProvider failover", () => {
  it("passes a real answer (account doesn't exist) straight through without trying the next endpoint", async () => {
    const t = twoEndpoints({ "a.example": viewAccountMissing, "b.example": okAccount });
    try {
      await expect(t.rpc.viewAccount("x.testnet")).rejects.toMatchObject({ type: "AccountDoesNotExist" });
      expect(t.calls).toEqual(["a.example"]);
    } finally {
      t.restore();
    }
  });

  it("fails over on a rate limit", async () => {
    const t = twoEndpoints({ "a.example": () => new Response('{"error":{"code":-429}}', { status: 429 }), "b.example": okAccount });
    try {
      await expect(t.rpc.viewAccount("x.testnet")).resolves.toMatchObject({ amount: 1n });
      expect(t.calls).toEqual(["a.example", "b.example"]);
    } finally {
      t.restore();
    }
  });

  it("uses a single endpoint as is", () => {
    expect(nearRpcProvider([{ url: "https://a.example" }])).toBeInstanceOf(JsonRpcProvider);
  });
});

describe("isTransportError", () => {
  it("separates endpoint trouble from answers", () => {
    expect(isTransportError(Object.assign(new Error("Rate limits exceeded"), { cause: 429 }))).toBe(true);
    expect(isTransportError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransportError(Object.assign(new Error("account doesn't exist"), { type: "AccountDoesNotExist" }))).toBe(false);
  });
});
