// Live NEAR Intents quotes for an heir's payout choice (CLAUDE.md §13A.2 item 1): real 1Click
// dry-run quotes on mainnet, public and confidential side by side. Dry quotes move no money and
// return no deposit address. The confidential quote needs the partner key (ONECLICK_JWT); without
// it this route still returns the public quote and says why the confidential one is missing.
export const runtime = "nodejs";

const BASE = process.env.ONECLICK_BASE_URL || "https://1click.chaindefuser.com";
const KEY = process.env.ONECLICK_JWT || "";
// The vault asset whose release is being quoted: NEAR, as wNEAR on NEAR.
const ORIGIN = "nep141:wrap.near";
// A dry quote still needs a refund account that exists on NEAR mainnet. Nothing is ever deposited,
// so nothing can be refunded to it.
const REFUND = process.env.QUOTE_REFUND_ACCOUNT || "relay.aurora";

interface Token {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
}

let tokenCache: { at: number; tokens: Token[] } | null = null;
async function tokens(): Promise<Token[]> {
  if (tokenCache && Date.now() - tokenCache.at < 10 * 60_000) return tokenCache.tokens;
  const res = await fetch(`${BASE}/v0/tokens`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`1Click tokens: HTTP ${res.status}`);
  tokenCache = { at: Date.now(), tokens: (await res.json()) as Token[] };
  return tokenCache.tokens;
}

const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 20) return true;
  recent.push(now);
  hits.set(ip, recent);
  // Bounded memory: drop the oldest address, not everyone's limits at once.
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return false;
}

export interface LiveQuote {
  amountOut: string;
  amountOutUsd: string;
  minAmountOut: string;
  timeEstimate: number;
}

async function quote(destinationAsset: string, amount: string, recipient: string, confidential: boolean): Promise<LiveQuote> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (KEY) headers["X-API-Key"] = KEY;
  const res = await fetch(`${BASE}/v0/quote`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: ORIGIN,
      depositType: "ORIGIN_CHAIN",
      destinationAsset,
      amount,
      refundTo: REFUND,
      refundType: "ORIGIN_CHAIN",
      recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      quoteWaitingTimeMs: 3000,
      ...(confidential ? { confidentiality: "basic" } : {}),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; quote?: Record<string, unknown> };
  if (!res.ok || !json.quote) {
    const msg = json.message ?? `HTTP ${res.status}`;
    if (/recipient is not valid/i.test(msg)) throw new Error("That address isn't valid on this chain.");
    if (/not available/i.test(msg)) throw new Error("No route for this pair right now.");
    if (/internal server error/i.test(msg)) throw new Error("NEAR Intents couldn't quote this (for a NEAR address, the account must exist on mainnet).");
    throw new Error(msg);
  }
  const q = json.quote;
  return {
    amountOut: String(q.amountOutFormatted),
    amountOutUsd: String(q.amountOutUsd),
    minAmountOut: String(q.minAmountOutFormatted ?? q.amountOutFormatted),
    timeEstimate: Number(q.timeEstimate ?? 0),
  };
}

const settle = (p: Promise<LiveQuote>) => p.then((quote) => ({ quote }), (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

export async function POST(req: Request) {
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (limited(ip)) return Response.json({ error: "Too many quotes from this address. Try again in a few minutes." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { destination_asset?: unknown; blockchain?: unknown; symbol?: unknown; recipient?: unknown; usd?: unknown };
  const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
  const usd = Math.min(1000, Math.max(1, Number(body.usd) || 10));
  if (!recipient || recipient.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(recipient)) return Response.json({ error: "Enter your address first." }, { status: 400 });
  let list: Token[];
  try {
    list = await tokens();
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const origin = list.find((t) => t.assetId === ORIGIN);
  // Either an exact asset id, or a chain and symbol (the /mainnet page doesn't load the token list).
  const destination =
    typeof body.destination_asset === "string"
      ? list.find((t) => t.assetId === body.destination_asset)
      : list.find((t) => t.blockchain === body.blockchain && t.symbol === body.symbol);
  const dest = destination?.assetId ?? "";
  if (!origin || !destination) return Response.json({ error: "Unknown asset." }, { status: 400 });
  if (!(origin.price > 0)) return Response.json({ error: "NEAR Intents has no NEAR price right now; try again shortly." }, { status: 502 });
  // $usd of NEAR in the origin's smallest units, rounded to 6 decimals first to stay exact.
  const amount = (BigInt(Math.round((usd / origin.price) * 1e6)) * 10n ** BigInt(origin.decimals - 6)).toString();
  const [pub, conf] = await Promise.all([
    settle(quote(dest, amount, recipient, false)),
    KEY ? settle(quote(dest, amount, recipient, true)) : Promise.resolve({ error: "Confidential quotes need a NEAR Intents partner key, which this deployment doesn't have." }),
  ]);
  return Response.json({
    origin: { symbol: "NEAR", amount: +(usd / origin.price).toFixed(4), usd },
    destination: { symbol: destination.symbol, blockchain: destination.blockchain },
    public: pub,
    confidential: conf,
    at: new Date().toISOString(),
  });
}
