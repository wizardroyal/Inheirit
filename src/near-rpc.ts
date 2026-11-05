// NEAR RPC with failover that only fails over when an endpoint is unhealthy.
// near-js's FailoverRpcProvider switches endpoint on *any* error, so a real answer such as
// "account doesn't exist" (every fresh agent account at boot) is retried on the next endpoint
// and then surfaces as a generic RetriesExceeded, which ShadeClient can't recognise.
import { FailoverRpcProvider, JsonRpcProvider } from "@near-js/providers";
import type { Provider } from "@near-js/providers";
import type { RpcEndpoint } from "./config";

/** True for errors that say the endpoint is unhealthy (HTTP status, rate limit, network), not the request. */
export function isTransportError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // fetchJsonRpc's ProviderError carries the HTTP status (429, 5xx, 408, ...) as a numeric cause
  if (typeof (e as { cause?: unknown }).cause === "number") return true;
  if ((e as { type?: unknown }).type === "RetriesExceeded") return true;
  if (e instanceof TypeError) return true; // undici: "fetch failed"
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|rate limit/i.test(e.message);
}

class TransportFailoverRpcProvider extends FailoverRpcProvider {
  constructor(private readonly endpoints: Provider[]) {
    super(endpoints);
    // withBackoff is private in near-js's typings; replace it for this instance only
    (this as unknown as { withBackoff: (g: (p: Provider) => Promise<unknown>) => Promise<unknown> }).withBackoff = (g) => this.tryEach(g);
  }

  private current = 0;

  private async tryEach(getResult: (p: Provider) => Promise<unknown>): Promise<unknown> {
    let last: unknown;
    for (let i = 0; i < this.endpoints.length; i++) {
      const p = this.endpoints[(this.current + i) % this.endpoints.length];
      try {
        const result = await getResult(p);
        this.current = (this.current + i) % this.endpoints.length;
        return result;
      } catch (e) {
        if (!isTransportError(e)) throw e;
        last = e;
      }
    }
    throw last;
  }
}

export function nearRpcProvider(endpoints: RpcEndpoint[]): Provider {
  const providers = endpoints.map((e) => new JsonRpcProvider(e));
  return providers.length > 1 ? new TransportFailoverRpcProvider(providers) : providers[0];
}
