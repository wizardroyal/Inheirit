// NEAR Intents 1Click API (CLAUDE.md §J.2). Field names checked against the live OpenAPI spec
// (https://1click.chaindefuser.com/docs/v0/openapi.yaml) on 2026-11-06.
// Two clients with one interface:
// - HttpOneClickClient: the real API (mainnet only; NEAR Intents has no testnet). Used by the local,
//   approval-gated scripts/mainnet-payout.ts, never by the agent.
// - SimulatedOneClickClient: quotes from real token prices, a fake deposit address, and a status that
//   walks PENDING_DEPOSIT → PROCESSING → SUCCESS. Labelled SIMULATED everywhere it shows up.
import { createHash, randomBytes } from "node:crypto";

export type OneClickStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
export const TERMINAL: readonly OneClickStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];

export interface IntentsToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
}

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
  quoteWaitingTimeMs: number;
  confidentiality?: "public" | "basic" | "advanced";
}

export interface Quote {
  depositAddress?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeEstimate: number;
  withdrawFee?: string;
  refundFee?: string;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export interface TxLink {
  hash: string;
  explorerUrl: string;
}

export interface StatusResponse {
  status: OneClickStatus;
  updatedAt: string;
  swapDetails?: {
    originChainTxHashes?: TxLink[];
    destinationChainTxHashes?: TxLink[];
    amountOutFormatted?: string;
    refundReason?: string;
  };
}

/** "Quoting for this pair is not available": a normal outcome (no solver answered). Retry later. */
export class NoRouteError extends Error {}

export interface OneClickClient {
  readonly simulated: boolean;
  tokens(): Promise<IntentsToken[]>;
  quote(req: QuoteRequest): Promise<QuoteResponse>;
  submitDeposit(txHash: string, depositAddress: string): Promise<void>;
  status(depositAddress: string): Promise<StatusResponse>;
}

export const ONECLICK_BASE_URL = "https://1click.chaindefuser.com";
const TOKENS_TTL_MS = 10 * 60_000;

/** A quote request with our defaults: exact input, 1% slippage, a 1 h deadline, wait for solvers. */
export function quoteRequest(
  p: Pick<QuoteRequest, "originAsset" | "destinationAsset" | "amount" | "refundTo" | "recipient"> & {
    dry: boolean;
    confidentiality?: QuoteRequest["confidentiality"];
    waitMs?: number;
    now?: Date;
  },
): QuoteRequest {
  const now = p.now ?? new Date();
  return {
    dry: p.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: p.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: p.destinationAsset,
    amount: p.amount,
    refundTo: p.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: p.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now.getTime() + 3600_000).toISOString(),
    quoteWaitingTimeMs: p.waitMs ?? 5000,
    ...(p.confidentiality && p.confidentiality !== "public" ? { confidentiality: p.confidentiality } : {}),
  };
}

function trimToken(t: IntentsToken): IntentsToken {
  return { assetId: t.assetId, decimals: t.decimals, blockchain: t.blockchain, symbol: t.symbol, price: t.price };
}

/** The real 1Click API. The key (a JWT) goes in X-API-Key, the spec's recommended header. */
export class HttpOneClickClient implements OneClickClient {
  readonly simulated = false;
  private tokenCache: { at: number; tokens: IntentsToken[] } | null = null;
  constructor(
    private readonly apiKey: string | undefined,
    private readonly baseUrl = ONECLICK_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      const msg = json.message ?? `HTTP ${res.status}`;
      if (/not available/i.test(msg)) throw new NoRouteError(msg);
      throw new Error(`1Click ${path}: ${res.status} ${msg}`);
    }
    return json as T;
  }

  async tokens(): Promise<IntentsToken[]> {
    if (this.tokenCache && Date.now() - this.tokenCache.at < TOKENS_TTL_MS) return this.tokenCache.tokens;
    const tokens = (await this.call<IntentsToken[]>("GET", "/v0/tokens")).map(trimToken);
    this.tokenCache = { at: Date.now(), tokens };
    return tokens;
  }

  quote(req: QuoteRequest) {
    return this.call<QuoteResponse>("POST", "/v0/quote", req);
  }

  async submitDeposit(txHash: string, depositAddress: string) {
    await this.call("POST", "/v0/deposit/submit", { txHash, depositAddress });
  }

  status(depositAddress: string) {
    return this.call<StatusResponse>("GET", `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  }
}

/** Used when /v0/tokens can't be reached: enough for the demo pickers. Prices are rough. */
export const FALLBACK_TOKENS: IntentsToken[] = [
  { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 3.7 },
  { assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimals: 6, blockchain: "near", symbol: "USDC", price: 1 },
  { assetId: "nep141:eth.omft.near", decimals: 18, blockchain: "eth", symbol: "ETH", price: 2240 },
  { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6, blockchain: "eth", symbol: "USDC", price: 1 },
  { assetId: "nep141:btc.omft.near", decimals: 8, blockchain: "btc", symbol: "BTC", price: 76000 },
  { assetId: "nep141:base.omft.near", decimals: 18, blockchain: "base", symbol: "ETH", price: 2240 },
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, blockchain: "base", symbol: "USDC", price: 1 },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, blockchain: "arb", symbol: "USDC", price: 1 },
  { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 90 },
  { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, blockchain: "sol", symbol: "USDC", price: 1 },
];

/** Formats smallest units as a decimal string with at most `maxFrac` fraction digits. */
export function formatUnits(amount: bigint, decimals: number, maxFrac = 6): string {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  if (decimals === 0) frac = "";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** USD value of `amount` smallest units of `token`. */
export function usdValue(amount: bigint, token: Pick<IntentsToken, "decimals" | "price">): number {
  // 1e6 fixed point keeps precision for 24-decimal tokens without floating overflow.
  const micro = (amount * 1_000_000n) / 10n ** BigInt(token.decimals);
  return (Number(micro) / 1e6) * token.price;
}

interface SimDeposit {
  createdAt: number;
  depositedAt?: number;
  quote: QuoteResponse;
}

/**
 * SIMULATED 1Click (§J.7): realistic quotes from real prices (live /v0/tokens when reachable, a
 * fallback list otherwise), a fake deposit address, and a status that moves on its own after the
 * "deposit": PROCESSING for a few seconds, then SUCCESS. Nothing is swapped or sent.
 */
export class SimulatedOneClickClient implements OneClickClient {
  readonly simulated = true;
  private readonly deposits = new Map<string, SimDeposit>();
  constructor(
    private readonly prices: { tokens(): Promise<IntentsToken[]> } = { tokens: async () => FALLBACK_TOKENS },
    private readonly opts: { now?: () => number; processingMs?: number; feeBps?: number } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  async tokens(): Promise<IntentsToken[]> {
    try {
      const t = await this.prices.tokens();
      if (t.length) return t;
    } catch {
      // fall through to the bundled list
    }
    return FALLBACK_TOKENS;
  }

  async quote(req: QuoteRequest): Promise<QuoteResponse> {
    const tokens = await this.tokens();
    const from = tokens.find((t) => t.assetId === req.originAsset);
    const to = tokens.find((t) => t.assetId === req.destinationAsset);
    if (!from || !to) throw new NoRouteError("Quoting for this pair is not available (SIMULATED: unknown asset)");
    const amountIn = BigInt(req.amount);
    const usdIn = usdValue(amountIn, from);
    // ~0.2% fees, plus a fixed withdraw fee of ~$0.005 when the asset changes chain.
    const usdOut = Math.max(0, usdIn * (1 - (this.opts.feeBps ?? 20) / 10_000) - (from.blockchain === to.blockchain ? 0 : 0.005));
    const outUnits = BigInt(Math.floor((usdOut / to.price) * 1e6)) * 10n ** BigInt(to.decimals) / 1_000_000n;
    const minOut = (outUnits * BigInt(10_000 - req.slippageTolerance)) / 10_000n;
    const quote: Quote = {
      amountIn: req.amount,
      amountInFormatted: formatUnits(amountIn, from.decimals),
      amountInUsd: usdIn.toFixed(4),
      amountOut: outUnits.toString(),
      amountOutFormatted: formatUnits(outUnits, to.decimals),
      amountOutUsd: usdOut.toFixed(4),
      minAmountOut: minOut.toString(),
      timeEstimate: 30,
      deadline: req.deadline,
    };
    const res: QuoteResponse = {
      correlationId: `sim-${randomBytes(6).toString("hex")}`,
      timestamp: new Date(this.now()).toISOString(),
      signature: "SIMULATED",
      quoteRequest: req,
      quote,
    };
    if (!req.dry) {
      const depositAddress = `SIMULATED-${createHash("sha256").update(res.correlationId).digest("hex").slice(0, 32)}`;
      quote.depositAddress = depositAddress;
      this.deposits.set(depositAddress, { createdAt: this.now(), quote: res });
      // Bounded: quotes nobody deposits to are forgotten oldest-first.
      if (this.deposits.size > 5000) this.deposits.delete(this.deposits.keys().next().value!);
    }
    return res;
  }

  async submitDeposit(_txHash: string, depositAddress: string): Promise<void> {
    const d = this.deposits.get(depositAddress);
    if (!d) throw new Error(`SIMULATED 1Click: unknown deposit address ${depositAddress}`);
    d.depositedAt ??= this.now();
  }

  async status(depositAddress: string): Promise<StatusResponse> {
    const d = this.deposits.get(depositAddress);
    if (!d) throw new Error(`SIMULATED 1Click: unknown deposit address ${depositAddress}`);
    const updatedAt = new Date(this.now()).toISOString();
    if (!d.depositedAt) return { status: "PENDING_DEPOSIT", updatedAt };
    if (this.now() - d.depositedAt < (this.opts.processingMs ?? 8000)) return { status: "PROCESSING", updatedAt };
    return { status: "SUCCESS", updatedAt, swapDetails: { amountOutFormatted: d.quote.quote.amountOutFormatted } };
  }
}
