// NEAR RPC for the browser with failover on unhealthy endpoints only (same rule as the agent's
// src/near-rpc.ts). A rate-limited endpoint answers 429 without CORS headers, which the browser reports
// as a bare "Failed to fetch"; the next endpoint is tried then. A real answer ("account doesn't exist",
// a contract panic) is returned as is. A signed transaction re-sent to another endpoint is the same
// transaction (same nonce and hash), so it can't execute twice.
import { FailoverRpcProvider, JsonRpcProvider, type Provider } from "@near-js/providers";

export function isTransportError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (typeof (e as { cause?: unknown }).cause === "number") return true; // HTTP status from fetchJsonRpc
  if ((e as { type?: unknown }).type === "RetriesExceeded") return true;
  if (e instanceof TypeError) return true; // "Failed to fetch" / "Load failed"
  return /failed to fetch|load failed|networkerror|rate limit/i.test(e.message);
}

class TransportFailoverRpcProvider extends FailoverRpcProvider {
  private current = 0;
  constructor(private readonly endpoints: Provider[]) {
    super(endpoints);
    (this as unknown as { withBackoff: (g: (p: Provider) => Promise<unknown>) => Promise<unknown> }).withBackoff = (g) => this.tryEach(g);
  }
  private async tryEach(getResult: (p: Provider) => Promise<unknown>): Promise<unknown> {
    let last: unknown;
    // Two rounds, with a short pause between, so a brief blip on every endpoint doesn't fail a step.
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < this.endpoints.length; i++) {
        const k = (this.current + i) % this.endpoints.length;
        try {
          const result = await getResult(this.endpoints[k]);
          this.current = k;
          return result;
        } catch (e) {
          if (!isTransportError(e)) throw e;
          last = e;
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw last;
  }
}

/** A provider over a comma-separated list of RPC URLs. */
export function rpcProvider(urls: string): Provider {
  const list = urls.split(",").map((u) => u.trim()).filter(Boolean);
  const providers = list.map((url) => new JsonRpcProvider({ url }));
  return providers.length > 1 ? new TransportFailoverRpcProvider(providers) : providers[0];
}
