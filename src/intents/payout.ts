// Universal payout and stable-value inheritance over NEAR Intents (CLAUDE.md §J.3, §J.4).
// Each released slice (an execution record: round, stage, chain, heir) is paid onward to the asset and
// chain the heir chose, through 1Click. On testnet the vaults' testnet transfers happen as before and
// this onward leg runs on the SIMULATED 1Click client: NEAR Intents has no testnet (§J.6, §J.7).
// Rules (§J.2):
// - heir without a payout choice: their slices wait ("awaiting heir") and pay out together later;
// - a batch below the minimum waits for more slices, unless the release is over;
// - same asset and chain as the vault: no swap, direct transfer;
// - "pair not available": retry with backoff, never fail or skip the slice;
// - one deposit address per batch, never deposited twice; REFUNDED/FAILED frees the slices for a new
//   batch, at most MAX_ATTEMPTS batches per slice.
import { createHash } from "node:crypto";
import type { Policy } from "../policy/policy";
import { type Chain, stateName, type WillView } from "../near/will-contract";
import type { PayoutBatch, PayoutPref, Store } from "../state/store";
import { type IntentsToken, NoRouteError, type OneClickClient, quoteRequest, TERMINAL, type TxLink, usdValue } from "./oneclick";

/** What each vault asset is called in NEAR Intents (its mainnet equivalent). */
export const ORIGIN_ASSET: Record<Chain, { assetId: string; symbol: string; blockchain: string }> = {
  Near: { assetId: "nep141:wrap.near", symbol: "NEAR", blockchain: "near" },
  Eth: { assetId: "nep141:eth.omft.near", symbol: "ETH", blockchain: "eth" },
  Btc: { assetId: "nep141:btc.omft.near", symbol: "BTC", blockchain: "btc" },
};

/** Chains heirs can choose, with their address format. */
export const PAYOUT_CHAINS: Record<string, { label: string; address: RegExp; hint: string }> = {
  near: { label: "NEAR", address: /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$|^[0-9a-f]{64}$/, hint: "a NEAR account, e.g. ada.near" },
  eth: { label: "Ethereum", address: /^0x[0-9a-fA-F]{40}$/, hint: "0x… address" },
  base: { label: "Base", address: /^0x[0-9a-fA-F]{40}$/, hint: "0x… address" },
  arb: { label: "Arbitrum", address: /^0x[0-9a-fA-F]{40}$/, hint: "0x… address" },
  op: { label: "Optimism", address: /^0x[0-9a-fA-F]{40}$/, hint: "0x… address" },
  pol: { label: "Polygon", address: /^0x[0-9a-fA-F]{40}$/, hint: "0x… address" },
  sol: { label: "Solana", address: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, hint: "Solana address" },
  btc: { label: "Bitcoin", address: /^(bc1[02-9ac-hj-np-z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/, hint: "bc1… address" },
};

export const PAYOUT_SYMBOLS = ["USDC", "USDT", "wNEAR", "ETH", "BTC", "SOL", "POL"];

/** The tokens heirs may pick from: supported chains, well-known symbols, priced. */
export function payoutTokens(tokens: IntentsToken[]): IntentsToken[] {
  return tokens.filter((t) => PAYOUT_CHAINS[t.blockchain] && PAYOUT_SYMBOLS.includes(t.symbol) && t.price > 0);
}

/** The stablecoin for stable-value mode on `blockchain`: USDC, else USDT (§J.4). */
export function stableAsset(tokens: IntentsToken[], blockchain: string): IntentsToken | null {
  for (const symbol of ["USDC", "USDT"]) {
    const t = tokens.find((x) => x.blockchain === blockchain && x.symbol === symbol);
    if (t) return t;
  }
  return null;
}

/** Checks an heir's payout choice against the token list; returns an error message or null. */
export function checkPayoutPref(tokens: IntentsToken[], p: { blockchain: string; assetId: string; address: string }): string | null {
  const chain = PAYOUT_CHAINS[p.blockchain];
  if (!chain) return `Payouts to ${p.blockchain} aren't offered`;
  const token = tokens.find((t) => t.assetId === p.assetId);
  if (!token || token.blockchain !== p.blockchain) return `That asset isn't available on ${chain.label}`;
  if (!chain.address.test(p.address)) return `Not a valid ${chain.label} address (expected ${chain.hint})`;
  return null;
}

export interface Slice {
  /** `${round}:${stage}:${chain}`; unique per heir. */
  key: string;
  heir: string;
  chain: Chain;
  amount: bigint;
}

/** Released slices per heir, from the on-chain execution records. Foreign records name the receive address. */
export function slicesFor(will: WillView, policy: Policy | undefined): Slice[] {
  const out: Slice[] = [];
  for (const e of will.executions) {
    let heir: string | undefined;
    if (e.chain === "Near") heir = e.to;
    else {
      const h = policy?.heirs.find((x) => (e.chain === "Eth" ? x.receive.eth?.toLowerCase() === e.to.toLowerCase() : x.receive.btc === e.to));
      heir = h?.near_account;
    }
    if (!heir || BigInt(e.amount) === 0n) continue;
    out.push({ key: `${e.round}:${e.stage}:${e.chain}`, heir, chain: e.chain, amount: BigInt(e.amount) });
  }
  return out;
}

/** Sends the origin asset to a 1Click deposit address. The SIMULATED sender sends nothing. */
export interface DepositSender {
  readonly simulated: boolean;
  send(batch: PayoutBatch): Promise<string>;
}

export const simulatedSender: DepositSender = {
  simulated: true,
  send: async (b) => `SIMULATED-tx-${createHash("sha256").update(`${b.id}:${b.depositAddress}`).digest("hex").slice(0, 24)}`,
};

export const MIN_PAYOUT_USD = 1;
export const MAX_ATTEMPTS = 3;
const BACKOFF_S = [30, 60, 120, 300];

export interface PayoutDeps {
  store: Store;
  client: OneClickClient;
  sender: DepositSender;
  /** Where 1Click refunds go: the will's vault on the origin chain. */
  refundTo(owner: string, chain: Chain): Promise<string>;
  now?: () => Date;
  log?: (msg: string) => void;
  minUsd?: number;
}

const FREED: readonly string[] = ["REFUNDED", "FAILED"];

export class PayoutEngine {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  constructor(private readonly deps: PayoutDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((m) => console.log(m));
  }

  /** Runs every tick for a will whose release has started (or was halted after some slices). */
  async run(will: WillView): Promise<void> {
    const owner = will.owner;
    const policy = this.deps.store.get().policies[owner];
    const slices = slicesFor(will, policy);
    if (!slices.length) return;
    const tokens = await this.deps.client.tokens();

    for (const b of this.batches(owner)) {
      if (!TERMINAL.includes(b.status as never)) await this.advance(b).catch((e) => this.fail(b, e));
    }

    const prefs = this.deps.store.get().payoutPrefs[owner] ?? {};
    const releaseOver = stateName(will.state) !== "Executing";
    for (const [heir, pref] of Object.entries(prefs)) {
      const pending = pendingSlices(slices, this.batches(owner), heir);
      for (const chain of ["Near", "Eth", "Btc"] as Chain[]) {
        const group = pending.filter((s) => s.chain === chain && !s.exhausted);
        if (!group.length) continue;
        const origin = tokens.find((t) => t.assetId === ORIGIN_ASSET[chain].assetId);
        if (!origin) continue;
        const amount = group.reduce((s, x) => s + x.amount, 0n);
        const usd = usdValue(amount, origin);
        if (usd < (this.deps.minUsd ?? MIN_PAYOUT_USD) && !releaseOver) continue; // accumulate
        const b = await this.newBatch(owner, heir, chain, group, amount, usd, pref, policy, tokens);
        await this.advance(b).catch((e) => this.fail(b, e));
      }
    }
  }

  private batches(owner: string): PayoutBatch[] {
    return this.deps.store.get().payouts[owner] ?? [];
  }

  private save(b: PayoutBatch) {
    b.updatedAt = this.now().toISOString();
    this.deps.store.update((s) => {
      const list = (s.payouts[b.owner] ??= []);
      const i = list.findIndex((x) => x.id === b.id);
      if (i >= 0) list[i] = { ...b };
      else list.push({ ...b });
    });
  }

  private async newBatch(
    owner: string,
    heir: string,
    chain: Chain,
    group: { key: string }[],
    amount: bigint,
    usd: number,
    pref: PayoutPref,
    policy: Policy | undefined,
    tokens: IntentsToken[],
  ): Promise<PayoutBatch> {
    const stable = policy?.payout_value_mode === "stable";
    const stableToken = stable ? stableAsset(tokens, pref.blockchain) : null;
    const dest = stableToken ?? tokens.find((t) => t.assetId === pref.assetId);
    const origin = ORIGIN_ASSET[chain];
    const at = this.now().toISOString();
    const b: PayoutBatch = {
      id: createHash("sha256").update(`${owner}:${heir}:${chain}:${group.map((s) => s.key).join(",")}:${this.batches(owner).length}:${at}`).digest("hex").slice(0, 16),
      owner,
      heir,
      chain,
      originAssetId: origin.assetId,
      originSymbol: origin.symbol,
      slices: group.map((s) => s.key),
      amount: amount.toString(),
      amountUsd: Number(usd.toFixed(4)),
      destAssetId: dest?.assetId ?? pref.assetId,
      destSymbol: dest?.symbol ?? pref.symbol,
      destChain: pref.blockchain,
      recipient: pref.address,
      stable: !!stableToken,
      mode: (dest?.assetId ?? pref.assetId) === origin.assetId ? "direct" : "intents",
      simulated: this.deps.client.simulated,
      status: "QUOTING",
      attempts: 0,
      createdAt: at,
      updatedAt: at,
    };
    if (stable && !stableToken) b.note = `No stablecoin on ${pref.blockchain}; paid in ${b.destSymbol} instead`;
    this.save(b);
    return b;
  }

  /** Moves one batch forward as far as it can this tick. */
  private async advance(b: PayoutBatch): Promise<void> {
    const nowMs = this.now().getTime();
    if (b.mode === "direct") {
      b.status = "SUCCESS";
      b.note = "Same asset and chain as the vault: sent directly, no swap";
      return this.save(b);
    }
    if ((b.status === "QUOTING" || b.status === "WAITING_ROUTE") && (!b.nextTryAt || Date.parse(b.nextTryAt) <= nowMs)) {
      try {
        const q = await this.deps.client.quote(
          quoteRequest({
            dry: false,
            originAsset: b.originAssetId,
            destinationAsset: b.destAssetId,
            amount: b.amount,
            refundTo: await this.deps.refundTo(b.owner, b.chain),
            recipient: b.recipient,
            now: this.now(),
          }),
        );
        if (!q.quote.depositAddress) throw new Error("1Click returned no deposit address");
        b.depositAddress = q.quote.depositAddress;
        b.quoteDeadline = q.quote.deadline;
        b.expectedOut = q.quote.amountOutFormatted;
        b.expectedOutUsd = q.quote.amountOutUsd;
        b.minAmountOut = q.quote.minAmountOut;
        b.status = "PENDING_DEPOSIT";
        b.error = undefined;
        this.save(b);
      } catch (e) {
        if (!(e instanceof NoRouteError)) throw e;
        b.attempts++;
        b.status = "WAITING_ROUTE";
        b.error = e.message;
        b.nextTryAt = new Date(nowMs + BACKOFF_S[Math.min(b.attempts - 1, BACKOFF_S.length - 1)] * 1000).toISOString();
        this.log(`[payout] ${b.owner} → ${b.heir}: no route for ${b.originSymbol} → ${b.destSymbol} on ${b.destChain} yet; retrying`);
        return this.save(b);
      }
    }
    if (b.status === "PENDING_DEPOSIT" && b.depositAddress && !b.depositTx) {
      if (b.quoteDeadline && Date.parse(b.quoteDeadline) <= nowMs) {
        b.status = "FAILED";
        b.error = "The quote expired before the deposit";
        return this.save(b);
      }
      // The tx hash is saved before anything else, so a deposit is never sent twice.
      b.depositTx = await this.deps.sender.send(b);
      this.save(b);
      await this.deps.client.submitDeposit(b.depositTx, b.depositAddress);
      b.status = "KNOWN_DEPOSIT_TX";
      this.save(b);
      this.log(`[payout] ${b.owner} → ${b.heir}: ${b.originSymbol} slice deposited for ${b.destSymbol} on ${b.destChain}${b.simulated ? " (SIMULATED)" : ""}`);
    }
    if (b.depositAddress && b.depositTx && !TERMINAL.includes(b.status as never)) {
      const st = await this.deps.client.status(b.depositAddress);
      b.status = st.status;
      const link = (l?: TxLink[]) => l?.[0];
      b.originTx = link(st.swapDetails?.originChainTxHashes) ?? b.originTx;
      b.destinationTx = link(st.swapDetails?.destinationChainTxHashes) ?? b.destinationTx;
      if (st.swapDetails?.amountOutFormatted) b.receivedOut = st.swapDetails.amountOutFormatted;
      if (st.swapDetails?.refundReason) b.error = st.swapDetails.refundReason;
      this.save(b);
    }
  }

  private fail(b: PayoutBatch, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    this.log(`[payout] ${b.owner} → ${b.heir}: ${msg}`);
    b.error = msg;
    if (!b.depositTx) {
      // Nothing was deposited: try again with a fresh quote, up to MAX_ATTEMPTS times.
      b.attempts++;
      b.depositAddress = undefined;
      b.status = b.attempts >= MAX_ATTEMPTS ? "FAILED" : "QUOTING";
      b.nextTryAt = new Date(this.now().getTime() + 60_000).toISOString();
    } else if (b.simulated && /unknown deposit address/.test(msg)) {
      // The SIMULATED client restarted and forgot the deposit; nothing real was sent, so free the slices.
      b.status = "FAILED";
    }
    // After a real deposit, only 1Click's status decides; keep polling.
    this.save(b);
  }
}

/** Slices of `heir` that are in no live batch. `exhausted`: already failed MAX_ATTEMPTS times. */
export function pendingSlices(slices: Slice[], batches: PayoutBatch[], heir: string): (Slice & { exhausted: boolean })[] {
  const mine = batches.filter((b) => b.heir === heir);
  return slices
    .filter((s) => s.heir === heir)
    .filter((s) => !mine.some((b) => b.chain === s.chain && b.slices.includes(s.key) && !FREED.includes(b.status)))
    .map((s) => ({ ...s, exhausted: mine.filter((b) => b.chain === s.chain && b.slices.includes(s.key)).length >= MAX_ATTEMPTS }));
}
