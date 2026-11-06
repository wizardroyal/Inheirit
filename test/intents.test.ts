import { describe, expect, it } from "vitest";
import { api } from "../src/api";
import { AuthError, type SignedAction } from "../src/auth/nep413";
import { FALLBACK_TOKENS, formatUnits, NoRouteError, type OneClickClient, quoteRequest, SimulatedOneClickClient, usdValue } from "../src/intents/oneclick";
import { checkPayoutPref, type DepositSender, PayoutEngine, simulatedSender, slicesFor, stableAsset } from "../src/intents/payout";
import type { WillState, WillView } from "../src/near/will-contract";
import { checkPolicy, type Policy } from "../src/policy/policy";
import { type PayoutBatch, Store } from "../src/state/store";

const T0 = 1_800_000_000_000;
const NEAR = 10n ** 24n;
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const ADA_BASE = "0x1111111111111111111111111111111111111111";
const ADA_ETH_TESTNET = "0x2222222222222222222222222222222222222222";

const parsed = checkPolicy({
  version: 1,
  owner: "alice.testnet",
  heirs: [
    { id: "ada", name: "Ada", near_account: "ada.testnet", receive: { eth: ADA_ETH_TESTNET } },
    { id: "tobi", name: "Tobi", near_account: "tobi.testnet" },
  ],
  allocations: [
    { asset: "NEAR", shares: { ada: 50, tobi: 50 } },
    { asset: "ETH", shares: { ada: 100 } },
  ],
  stages_pct: [10, 20, 30, 40],
  guardians: ["g1.testnet"],
  guardian_threshold: 1,
});
if (!parsed.ok) throw new Error(parsed.errors.join("; "));
const POLICY = parsed.policy;

function will(state: WillState, executions: WillView["executions"]): WillView {
  return {
    owner: "alice.testnet",
    heirs: [
      { account_id: "ada.testnet", name: "Ada", near_share_bps: 5000, x25519_pubkey: null },
      { account_id: "tobi.testnet", name: "Tobi", near_share_bps: 5000, x25519_pubkey: null },
    ],
    guardians: [{ account_id: "g1.testnet", accepted: true }],
    guardian_threshold: 1,
    contacts: [],
    stages: [],
    accelerated_stages: [],
    round_stages: [],
    timings: { quiet_after: 120, nudge_period: 60, welfare_period: 60, vote_period: 300, challenge_period: 120, secrets_buffer: 60 },
    policy_hash: "0".repeat(64),
    foreign_chains: ["Eth"],
    lawyer: null,
    heirs_hidden: true,
    accelerated: false,
    state,
    last_alive_at: 0,
    execution_round: 1,
    near_balance: "0",
    pending_withdrawals: [],
    executions,
    stage_done: [],
    sealed_notes: [],
    released_notes: [],
  };
}
const exec = (stage: number, chain: "Near" | "Eth", to: string, amount: bigint) => ({ round: 1, stage, chain, to, amount: amount.toString(), tx_hash: "" });

function setup(opts: { policy?: Policy; client?: OneClickClient; sender?: DepositSender; minUsd?: number } = {}) {
  let now = T0;
  const store = new Store(null);
  store.update((s) => (s.policies["alice.testnet"] = opts.policy ?? POLICY));
  const client = opts.client ?? new SimulatedOneClickClient(undefined, { now: () => now, processingMs: 5000 });
  const logs: string[] = [];
  const engine = new PayoutEngine({
    store,
    client,
    sender: opts.sender ?? simulatedSender,
    refundTo: async (_o, chain) => (chain === "Near" ? "inheirit.testnet" : "0xvault"),
    now: () => new Date(now),
    log: (m) => logs.push(m),
    minUsd: opts.minUsd,
  });
  const prefer = (heir: string, blockchain: string, assetId: string, address: string, symbol = "USDC") =>
    store.update((s) => ((s.payoutPrefs["alice.testnet"] ??= {})[heir] = { blockchain, assetId, symbol, address, setAt: new Date(now).toISOString() }));
  const batches = () => store.get().payouts["alice.testnet"] ?? [];
  return { store, engine, prefer, batches, logs, advance: (ms: number) => (now += ms) };
}

describe("1Click helpers", () => {
  it("builds the quote request the spec requires, with solver wait time and confidentiality only when asked", () => {
    const q = quoteRequest({ dry: true, originAsset: "a", destinationAsset: "b", amount: "5", refundTo: "r", recipient: "x", now: new Date(T0) });
    expect(q).toMatchObject({
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      depositType: "ORIGIN_CHAIN",
      refundType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      quoteWaitingTimeMs: 5000,
      deadline: new Date(T0 + 3600_000).toISOString(),
    });
    expect(q).not.toHaveProperty("confidentiality");
    expect(quoteRequest({ dry: true, originAsset: "a", destinationAsset: "b", amount: "5", refundTo: "r", recipient: "x", confidentiality: "basic" }).confidentiality).toBe("basic");
  });
  it("formats units and values them in USD", () => {
    expect(formatUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatUnits(NEAR / 10n, 24)).toBe("0.1");
    expect(usdValue(2n * NEAR, { decimals: 24, price: 3.5 })).toBeCloseTo(7);
  });
  it("picks USDC for stable mode, else USDT, else nothing", () => {
    const tokens = [...FALLBACK_TOKENS, { assetId: "usdt-tron", decimals: 6, blockchain: "tron", symbol: "USDT", price: 1 }];
    expect(stableAsset(tokens, "base")?.assetId).toBe(BASE_USDC);
    expect(stableAsset(tokens, "tron")?.symbol).toBe("USDT");
    expect(stableAsset(tokens, "btc")).toBeNull();
  });
  it("checks an heir's choice: offered chain, asset on that chain, address format", () => {
    expect(checkPayoutPref(FALLBACK_TOKENS, { blockchain: "base", assetId: BASE_USDC, address: ADA_BASE })).toBeNull();
    expect(checkPayoutPref(FALLBACK_TOKENS, { blockchain: "base", assetId: SOL_USDC, address: ADA_BASE })).toMatch(/isn't available/);
    expect(checkPayoutPref(FALLBACK_TOKENS, { blockchain: "sol", assetId: SOL_USDC, address: ADA_BASE })).toMatch(/Not a valid Solana/);
    expect(checkPayoutPref(FALLBACK_TOKENS, { blockchain: "near", assetId: "nep141:wrap.near", address: "ada.near" })).toBeNull();
    expect(checkPayoutPref(FALLBACK_TOKENS, { blockchain: "doge", assetId: "x", address: "y" })).toMatch(/aren't offered/);
  });
  it("SIMULATED status walks PENDING_DEPOSIT → PROCESSING → SUCCESS", async () => {
    let now = T0;
    const c = new SimulatedOneClickClient(undefined, { now: () => now, processingMs: 5000 });
    const q = await c.quote(quoteRequest({ dry: false, originAsset: "nep141:wrap.near", destinationAsset: BASE_USDC, amount: NEAR.toString(), refundTo: "r", recipient: ADA_BASE }));
    const addr = q.quote.depositAddress!;
    expect(Number(q.quote.amountOutUsd)).toBeCloseTo(3.7 * 0.998 - 0.005, 3);
    expect((await c.status(addr)).status).toBe("PENDING_DEPOSIT");
    await c.submitDeposit("tx", addr);
    expect((await c.status(addr)).status).toBe("PROCESSING");
    now += 6000;
    expect((await c.status(addr)).status).toBe("SUCCESS");
    expect((await c.quote({ ...q.quoteRequest, dry: true })).quote.depositAddress).toBeUndefined();
  });
});

describe("slices", () => {
  it("maps NEAR records by account and foreign records by the heir's receive address", () => {
    const s = slicesFor(will("Executing" as never, [exec(0, "Near", "ada.testnet", NEAR), exec(0, "Eth", ADA_ETH_TESTNET.toUpperCase().replace("0X", "0x"), 10n ** 15n), exec(0, "Eth", "0xunknown", 1n)]), POLICY);
    expect(s.map((x) => [x.heir, x.key])).toEqual([
      ["ada.testnet", "1:0:Near"],
      ["ada.testnet", "1:0:Eth"],
    ]);
  });
});

describe("universal payout (SIMULATED)", () => {
  const executing = { Executing: { stage: 1, since: 0, stage_started: 0 } } as WillState;

  it("mixed heirs: Ada gets USDC on Base, Tobi chooses late and his slices pay out together", async () => {
    const t = setup();
    t.prefer("ada.testnet", "base", BASE_USDC, ADA_BASE);
    const w = will(executing, [exec(0, "Near", "ada.testnet", NEAR), exec(0, "Near", "tobi.testnet", NEAR)]);
    await t.engine.run(w);
    expect(t.batches()).toHaveLength(1);
    const ada = t.batches()[0];
    expect(ada).toMatchObject({ heir: "ada.testnet", destSymbol: "USDC", destChain: "base", status: "PROCESSING", simulated: true, mode: "intents" });
    expect(ada.depositTx).toMatch(/^SIMULATED-tx-/);

    // Tobi hasn't chosen: nothing is sent for him. A second slice is released meanwhile.
    const w2 = will(executing, [...w.executions, exec(1, "Near", "tobi.testnet", 2n * NEAR)]);
    t.advance(6000);
    await t.engine.run(w2);
    expect(t.batches().find((b) => b.heir === "ada.testnet")!.status).toBe("SUCCESS");
    expect(t.batches().some((b) => b.heir === "tobi.testnet")).toBe(false);

    t.prefer("tobi.testnet", "sol", SOL_USDC, "So11111111111111111111111111111111111111112");
    await t.engine.run(w2);
    const tobi = t.batches().filter((b) => b.heir === "tobi.testnet");
    expect(tobi).toHaveLength(1);
    expect(tobi[0].slices).toEqual(["1:0:Near", "1:1:Near"]);
    expect(tobi[0].amount).toBe((3n * NEAR).toString());
  });

  it("never deposits twice for the same slices across ticks", async () => {
    let sends = 0;
    const t = setup({ sender: { simulated: true, send: async (b) => (sends++, `tx-${b.id}`) } });
    t.prefer("ada.testnet", "base", BASE_USDC, ADA_BASE);
    const w = will(executing, [exec(0, "Near", "ada.testnet", NEAR)]);
    for (let i = 0; i < 4; i++) {
      await t.engine.run(w);
      t.advance(2000);
    }
    expect(sends).toBe(1);
    expect(t.batches()).toHaveLength(1);
  });

  it("stable mode converts to USDC on the heir's chain even if they chose another asset", async () => {
    const t = setup({ policy: { ...POLICY, payout_value_mode: "stable" } });
    t.prefer("ada.testnet", "base", "nep141:base.omft.near", ADA_BASE, "ETH");
    await t.engine.run(will(executing, [exec(0, "Near", "ada.testnet", NEAR)]));
    expect(t.batches()[0]).toMatchObject({ destAssetId: BASE_USDC, destSymbol: "USDC", stable: true });
  });

  it("stable mode on a chain without a stablecoin pays in the chosen asset and says so", async () => {
    const t = setup({ policy: { ...POLICY, payout_value_mode: "stable" } });
    t.prefer("ada.testnet", "btc", "nep141:btc.omft.near", "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", "BTC");
    await t.engine.run(will(executing, [exec(0, "Near", "ada.testnet", NEAR)]));
    expect(t.batches()[0]).toMatchObject({ destSymbol: "BTC", stable: false });
    expect(t.batches()[0].note).toMatch(/No stablecoin/);
  });

  it("same asset and chain as the vault: direct transfer, no 1Click", async () => {
    const t = setup();
    t.prefer("ada.testnet", "near", "nep141:wrap.near", "ada.near", "wNEAR");
    await t.engine.run(will(executing, [exec(0, "Near", "ada.testnet", NEAR)]));
    expect(t.batches()[0]).toMatchObject({ mode: "direct", status: "SUCCESS" });
    expect(t.batches()[0].depositAddress).toBeUndefined();
  });

  it("small slices accumulate below the minimum, and go out once the release is over", async () => {
    const t = setup({ minUsd: 5 });
    t.prefer("ada.testnet", "base", BASE_USDC, ADA_BASE);
    const small = NEAR / 2n; // ~$1.85
    const w = will(executing, [exec(0, "Near", "ada.testnet", small)]);
    await t.engine.run(w);
    expect(t.batches()).toHaveLength(0);
    await t.engine.run(will(executing, [...w.executions, exec(1, "Near", "ada.testnet", small)]));
    expect(t.batches()).toHaveLength(0);
    await t.engine.run(will({ SecretsBuffer: { since: 0 } }, [...w.executions, exec(1, "Near", "ada.testnet", small)]));
    expect(t.batches()).toHaveLength(1);
    expect(t.batches()[0].slices).toEqual(["1:0:Near", "1:1:Near"]);
  });

  it("'pair not available' holds the slice and retries with backoff, never failing it", async () => {
    let fail = true;
    const sim = new SimulatedOneClickClient();
    const client: OneClickClient = {
      simulated: true,
      tokens: () => sim.tokens(),
      quote: async (r) => {
        if (fail) throw new NoRouteError("Quoting for this pair is not available");
        return sim.quote(r);
      },
      submitDeposit: (a, b) => sim.submitDeposit(a, b),
      status: (a) => sim.status(a),
    };
    const t = setup({ client });
    t.prefer("ada.testnet", "base", BASE_USDC, ADA_BASE);
    const w = will(executing, [exec(0, "Near", "ada.testnet", NEAR)]);
    for (let i = 0; i < 6; i++) {
      await t.engine.run(w);
      t.advance(400_000);
    }
    const b = t.batches()[0];
    expect(t.batches()).toHaveLength(1);
    expect(b.status).toBe("WAITING_ROUTE");
    expect(b.attempts).toBe(6);
    fail = false;
    await t.engine.run(w);
    expect(t.batches()[0].status).toBe("PROCESSING");
  });

  it("a refund frees the slices for a new batch, up to the attempt cap", async () => {
    const sim = new SimulatedOneClickClient();
    const client: OneClickClient = {
      simulated: true,
      tokens: () => sim.tokens(),
      quote: (r) => sim.quote(r),
      submitDeposit: (a, b) => sim.submitDeposit(a, b),
      status: async () => ({ status: "REFUNDED", updatedAt: "", swapDetails: { refundReason: "slippage" } }),
    };
    const t = setup({ client });
    t.prefer("ada.testnet", "base", BASE_USDC, ADA_BASE);
    const w = will(executing, [exec(0, "Near", "ada.testnet", NEAR)]);
    for (let i = 0; i < 6; i++) await t.engine.run(w);
    expect(t.batches().map((b: PayoutBatch) => b.status)).toEqual(["REFUNDED", "REFUNDED", "REFUNDED"]);
    expect(t.batches()[0].error).toBe("slippage");
  });

  it("an expired, unsent quote is dropped and the slices are quoted again", async () => {
    const t = setup({ sender: { simulated: true, send: async () => { throw new Error("rpc down"); } } });
    t.prefer("ada.testnet", "base", BASE_USDC, ADA_BASE);
    const w = will(executing, [exec(0, "Near", "ada.testnet", NEAR)]);
    await t.engine.run(w);
    expect(t.batches()[0]).toMatchObject({ status: "QUOTING", attempts: 1 });
    expect(t.batches()[0].depositAddress).toBeUndefined();
  });
});

describe("Intents API", () => {
  const verifier = {
    async verify(input: unknown, action: SignedAction) {
      const m = input as { owner: string; action: SignedAction; data?: unknown };
      if (m.action !== action) throw new AuthError("bad signature");
      return { owner: m.owner, action, issuedAt: 0, data: m.data };
    },
  };
  function setupApi(executions: WillView["executions"] = []) {
    const store = new Store(null);
    store.update((s) => (s.policies["alice.testnet"] = POLICY));
    const w = will(executions.length ? ({ Executing: { stage: 0, since: 0, stage_started: 0 } } as WillState) : "Active", executions);
    const contract = { getWill: async (o: string) => (o === "alice.testnet" ? w : null) } as never;
    const app = api({ contract, store, vaults: [], demoMode: true, agentInfo: async () => ({}), auth: verifier, intents: new SimulatedOneClickClient() });
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    return { app, post, store };
  }
  const choice = (heir: string, data: Record<string, string>) => ({ signed: { owner: heir, action: "payout_pref", data: { owner: "alice.testnet", ...data } } });

  it("saves a signed heir's valid choice and refuses non-heirs, bad addresses and unsigned requests", async () => {
    const t = setupApi();
    const ok = await t.post("/api/heir/payout", choice("ada.testnet", { blockchain: "base", asset_id: BASE_USDC, address: ADA_BASE }));
    expect(ok.status).toBe(200);
    expect(t.store.get().payoutPrefs["alice.testnet"]["ada.testnet"]).toMatchObject({ blockchain: "base", symbol: "USDC" });
    expect((await t.post("/api/heir/payout", choice("eve.testnet", { blockchain: "base", asset_id: BASE_USDC, address: ADA_BASE }))).status).toBe(403);
    expect((await t.post("/api/heir/payout", choice("ada.testnet", { blockchain: "base", asset_id: BASE_USDC, address: "nope" }))).status).toBe(400);
    expect((await t.post("/api/heir/payout", { owner: "alice.testnet", blockchain: "base" })).status).toBe(401);
  });

  it("reveals nothing about heirs' choices before any slice is released", async () => {
    const t = setupApi();
    await t.post("/api/heir/payout", choice("ada.testnet", { blockchain: "base", asset_id: BASE_USDC, address: ADA_BASE }));
    const body = await (await t.app.request("/api/payouts/alice.testnet")).json();
    expect(body).toMatchObject({ started: false, heirs: {}, simulated: true });
  });

  it("after release starts, lists each heir's choice and waiting slices", async () => {
    const t = setupApi([exec(0, "Near", "tobi.testnet", NEAR)]);
    const body = await (await t.app.request("/api/payouts/alice.testnet")).json();
    expect(body.started).toBe(true);
    expect(body.heirs["tobi.testnet"]).toMatchObject({ pref: null, batches: [] });
    expect(body.heirs["tobi.testnet"].waiting[0]).toMatchObject({ key: "1:0:Near", symbol: "NEAR" });
  });

  it("fund from anywhere: quotes into the vault, then a SIMULATED deposit reaches SUCCESS", async () => {
    const t = setupApi();
    const q = await (await t.post("/api/intents/fund-quote", { owner: "alice.testnet", vault: "Near", origin_asset: BASE_USDC, amount: "25" })).json();
    expect(q).toMatchObject({ simulated: true, vault: "Near", recipient: "alice.testnet" });
    expect(Number(q.quote.amountOutFormatted)).toBeGreaterThan(6);
    const addr = q.quote.depositAddress;
    expect((await (await t.app.request(`/api/intents/status?depositAddress=${addr}`)).json()).status).toBe("PENDING_DEPOSIT");
    expect((await t.post("/api/intents/fund-sent", { deposit_address: addr })).status).toBe(200);
    expect((await (await t.app.request(`/api/intents/status?depositAddress=${addr}`)).json()).status).toBe("PROCESSING");
  });

  it("lists payout tokens for the pickers", async () => {
    const body = await (await setupApi().app.request("/api/intents/tokens")).json();
    expect(body.enabled).toBe(true);
    expect(body.tokens.some((t: { assetId: string }) => t.assetId === BASE_USDC)).toBe(true);
  });
});
