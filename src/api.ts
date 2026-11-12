// HTTP API of the will agent. The web app (Day 4) and demo scripts use it.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { AttestationResult } from "./ai/attestation";
import type { GuideAnswer, GuideTurn } from "./ai/heir-guide";
import { AuthError, type Nep413Verifier, type SignedAction, type Verified } from "./auth/nep413";
import { AI_DRAFT_LIMIT, AI_GUIDE_LIMIT, FAUCET_LIMIT, FUND_QUOTE_LIMIT, RateLimiter, SIGNAL_LIMIT } from "./auth/rate-limit";
import type { FaucetSend } from "./demo/faucet";
import type { PolicyDraft } from "./ai/policy-parser";
import type { ChainVault } from "./executor/executor";
import { stateName, type WillContract, type WillView } from "./near/will-contract";
import { checkPolicy, policyHash, type Policy } from "./policy/policy";
import { SIMULATED_SOURCES } from "./signals/adapters";
import type { SignalSource } from "./liveness/score";
import type { Baseline } from "./liveness/baseline";
import { explainLiveness } from "./liveness/verdict";
import type { Notification, OwnerSignalConfig, Store } from "./state/store";
import type { TelegramBot } from "./telegram/bot";
import { type OneClickClient, quoteRequest, usdValue } from "./intents/oneclick";
import { checkPayoutPref, MIN_PAYOUT_USD, ORIGIN_ASSET, payoutTokens, pendingSlices, slicesFor } from "./intents/payout";

export interface ApiDeps {
  /** The owner's transaction history (NEAR accounts, Sepolia addresses) → their usual rhythm. Optional: tests leave it out. */
  baseline?: (near: string[], sepolia: string[]) => Promise<Baseline>;
  contract: WillContract;
  store: Store;
  vaults: ChainVault[];
  demoMode: boolean;
  agentInfo: () => Promise<Record<string, unknown>>;
  /** A sign of life arrived for this owner; the driver ticks the will right away (snap-back latency). */
  onSignOfLife?: (owner: string) => void;
  /** Checks owner-signed (NEP-413) requests. */
  auth: Pick<Nep413Verifier, "verify">;
  /** Demo vault faucet; absent unless demo mode has pool keys configured. */
  faucet?: {
    ethAddress: string;
    btcAddress: string;
    amounts: { eth_wei: string; btc_sats: number };
    send(chain: "Eth" | "Btc", to: string): Promise<FaucetSend>;
  };
  /** Telegram check bot; absent when TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME aren't set. */
  telegram?: Pick<TelegramBot, "issueLink" | "isLinked" | "username">;
  /** NEAR Intents 1Click client (SIMULATED on testnet, §J.7); absent = Intents routes off. Kept
   * separate from the payout engine's client, so unsigned fund quotes can't crowd out its deposits. */
  intents?: OneClickClient;
  /** Override the default rate limits (tests). */
  limiters?: { draft: RateLimiter; guide: RateLimiter; faucet: RateLimiter; fund?: RateLimiter };
  /** Absent when NEARAI_API_KEY isn't configured. */
  ai?: {
    attestation(): Promise<AttestationResult>;
    draftPolicy(owner: string, text: string): Promise<PolicyDraft>;
    heirGuide(will: WillView, heir: string, policy: Policy | undefined, question: string, history: GuideTurn[]): Promise<GuideAnswer>;
  };
}

// States in which heirs may be named (§5.5 heirs hidden).
const REVEALED = ["Executing", "SecretsBuffer", "SecretsReleased", "Completed"];
const maskEmail = (e: string) => {
  const [user, domain = ""] = e.split("@");
  return `${user.slice(0, 1)}…@${domain}`;
};

const DraftText = z.object({ text: z.string().min(10).max(4000) });

const GuideRequest = z.object({
  owner: z.string().min(2),
  question: z.string().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(8).default([]),
});

const NEAR_ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;
const OwnerFields = z.object({
  evm_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  /** Extra Sepolia addresses and NEAR accounts (testnet, or mainnet *.near) the owner uses; replace the saved lists. */
  evm_addresses: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(5).optional(),
  near_accounts: z.array(z.string().regex(NEAR_ACCOUNT)).max(5).optional(),
  /** Email for the will's guardians, friends, lawyer and heirs (account → address); replaces the saved map. */
  people_emails: z
    .record(z.string().regex(NEAR_ACCOUNT), z.string().email().max(254))
    .refine((m) => Object.keys(m).length <= 16, "At most 16 addresses")
    .optional(),
  github: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
  email: z.string().email().optional(),
});

const PayoutChoice = z.object({
  owner: z.string().min(2),
  blockchain: z.string().min(2).max(16),
  asset_id: z.string().min(3).max(200),
  address: z.string().min(2).max(128),
});

const FundQuote = z.object({
  owner: z.string().min(2),
  vault: z.enum(["Near", "Eth", "Btc"]),
  origin_asset: z.string().min(3).max(200),
  /** Decimal amount of the origin asset, e.g. "25". */
  amount: z.string().regex(/^\d{1,12}(\.\d{1,18})?$/),
});

/** "1.5" with 6 decimals -> 1500000n. */
function parseUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

const DemoSignalFields = z.object({
  source: z.enum(SIMULATED_SOURCES.map((s) => s.source) as [string, ...string[]]),
  at: z.string().datetime().optional(),
});

/** Public view of what the agent watches: which sources are set, never the addresses or handles. */
function watchingFlags(cfg: OwnerSignalConfig | undefined) {
  return cfg
    ? {
        evm: !!cfg.evmAddress || !!cfg.evmAddresses?.length,
        github: !!cfg.github,
        email: !!cfg.email,
        // Counts, not values: the public status never names the owner's other accounts or addresses.
        near_extra: cfg.nearAccounts?.length ?? 0,
        evm_count: (cfg.evmAddress ? 1 : 0) + (cfg.evmAddresses?.length ?? 0),
        since: cfg.watchedSince ?? null,
      }
    : null;
}

export const WEB_ORIGINS = ["https://inheirit.xyz", "https://www.inheirit.xyz", "https://inheirit.vercel.app"];
/** The app's own origins, plus any localhost port (local runs, the README's "run it yourself"). */
export function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (WEB_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function api(deps: ApiDeps): Hono {
  const app = new Hono();
  // The web app's origins only (plus localhost for running it yourself). Every write is NEP-413 signed
  // anyway; this just keeps other sites' pages from reading the agent's answers in a visitor's browser.
  app.use(cors({ origin: (o) => (allowedOrigin(o) ? o : null) }));
  const { contract, store } = deps;
  const limiters = deps.limiters ?? {
    draft: new RateLimiter(AI_DRAFT_LIMIT),
    guide: new RateLimiter(AI_GUIDE_LIMIT),
    faucet: new RateLimiter(FAUCET_LIMIT),
  };
  const fundLimiter = deps.limiters?.fund ?? new RateLimiter(FUND_QUOTE_LIMIT);
  const signalLimiter = new RateLimiter(SIGNAL_LIMIT);
  // Owners with a faucet request in flight: concurrent requests would each see "not funded yet" and
  // send again (break-it pass 2, F4).
  const faucetBusy = new Set<string>();
  // Many open pages poll these routes; each call costs the agent RPC/Sepolia/mempool requests from one
  // IP, so answers are shared for a few seconds.
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  // Baselines live in their own cache: writes clear the read cache, and a heartbeat shouldn't refetch
  // 90 days of history. Keyed by the sources, so a newly added address is picked up at once.
  const baselines = new Map<string, { at: number; value: Promise<Baseline | null> }>();
  function usualRhythm(owner: string, cfg?: OwnerSignalConfig): Promise<Baseline | null> {
    const near = [owner, ...(cfg?.nearAccounts ?? [])];
    const evm = [...(cfg?.evmAddress ? [cfg.evmAddress] : []), ...(cfg?.evmAddresses ?? [])];
    const key = `${near.join(",")}|${evm.join(",")}`;
    const hit = baselines.get(key);
    if (hit && Date.now() - hit.at < 86_400_000) return hit.value;
    const value = deps.baseline ? deps.baseline(near, evm).catch(() => null) : Promise.resolve(null);
    baselines.set(key, { at: Date.now(), value });
    if (baselines.size > 2000) baselines.delete(baselines.keys().next().value!);
    return value;
  }

  function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = fn();
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.delete(key));
    // Bounded: drop the oldest entry, not everyone's cached answers at once.
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return value;
  }
  const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;
  const tooMany = (waitMs: number) => ({ error: "Too many requests; try again later", retry_after_s: Math.ceil(waitMs / 1000) });

  // Notification records are public (the owner's dashboards read them unsigned), so recipients are
  // masked: email addresses are shortened, and heirs are named only while the will is in a state
  // where heirs are revealed (§5.5 heirs hidden); after a halt they are hidden again.
  function publicNotifications(list: Notification[], will: WillView | null): Notification[] {
    const revealed = !!will && REVEALED.includes(stateName(will.state));
    const heirs = new Set(will?.heirs.map((h) => h.account_id) ?? []);
    const mask = (to: string) => (to.includes("@") ? maskEmail(to) : heirs.has(to) && !revealed ? "an heir" : to);
    return list.map((n) => ({ ...n, to: [...new Set(n.to.map(mask))] }));
  }

  app.get("/", (c) => c.json({ message: "Inheirit will agent is running", demoMode: deps.demoMode }));
  app.get("/api/agent-info", async (c) => c.json(await deps.agentInfo()));

  // Every request that changes a will's data or spends our credit is NEP-413 signed by the account it
  // acts for, demo mode included: the hosted demo runs in demo mode, so an unsigned path there would
  // let a stranger act for any owner. Returns the signer and the payload fields, or a response.
  async function ownerRequest<T extends z.ZodTypeAny>(body: unknown, action: SignedAction, fields: T, unsignedError = "This request must be signed by the account (NEP-413)") {
    const signed = (body as { signed?: unknown } | null)?.signed;
    if (!signed) return { error: { status: 401 as const, body: { error: unsignedError } } };
    let v: Verified;
    try {
      v = await deps.auth.verify(signed, action);
    } catch (e) {
      const msg = e instanceof AuthError || e instanceof z.ZodError ? e.message : `could not check the signature: ${String(e)}`;
      return { error: { status: 401 as const, body: { error: msg } } };
    }
    const data = fields.safeParse(v.data ?? {});
    if (!data.success) return { error: { status: 400 as const, body: { error: data.error.issues } } };
    return { owner: v.owner, data: data.data as z.infer<T>, signed: true };
  }

  // Which public identities to watch for an owner. Anyone could claim a busy EVM address or GitHub
  // handle for someone else's will and keep it "alive" forever, so it is always owner-signed, demo
  // mode included (the hosted demo runs in demo mode).
  app.post("/api/owners", async (c) => {
    const r = await ownerRequest(await c.req.json(), "register_owner", OwnerFields, "Watching settings must be signed by the owner");
    if (r.error) return c.json(r.error.body, r.error.status);
    const { evm_address, evm_addresses, near_accounts, people_emails, github, email } = r.data;
    const will = await contract.getWill(r.owner);
    if (!will) return c.json({ error: `No will for ${r.owner}` }, 404);
    // The release itself must not count as a sign of life: the will's own ETH vault (its nonce rises
    // with every slice) and an heir's receive address are refused.
    const evms = [...(evm_address ? [evm_address] : []), ...(evm_addresses ?? [])];
    if (evms.length) {
      const eth = deps.vaults.find((v) => v.chain === "Eth");
      const vault = eth ? (await eth.address(r.owner).catch(() => "")).toLowerCase() : "";
      const heirs = (store.get().policies[r.owner]?.heirs ?? []).map((h) => h.receive?.eth?.toLowerCase());
      for (const e of evms) {
        const a = e.toLowerCase();
        if (a === vault) return c.json({ error: "That is this will's own vault address; give an address you use yourself" }, 400);
        if (heirs.includes(a)) return c.json({ error: "That is an heir's receive address; give an address you use yourself" }, 400);
      }
    }
    // An heir's activity must never keep the owner "alive" (heirs would stall their own release, and it
    // would hide the owner's silence), nor the contract's own; the owner's account already counts.
    // Emails only for people in this will: anyone else would be a stranger the agent mails.
    const people = new Set([...(will.guardians ?? []).map((g) => g.account_id), ...(will.contacts ?? []), ...(will.lawyer ? [will.lawyer] : []), ...(will.heirs ?? []).map((h) => h.account_id)]);
    for (const a of Object.keys(people_emails ?? {})) if (!people.has(a)) return c.json({ error: `${a} isn't a guardian, friend, lawyer or heir in this will` }, 400);
    for (const n of near_accounts ?? []) {
      if (n === r.owner) return c.json({ error: "Your own account already counts" }, 400);
      if (will.heirs.some((h) => h.account_id === n)) return c.json({ error: `${n} is an heir; give an account you use yourself` }, 400);
      if (n === process.env.AGENT_CONTRACT_ID) return c.json({ error: "That is the will contract itself" }, 400);
    }
    const watchedSince = new Date().toISOString();
    // Fields left out keep their saved value, so re-registering (Start over, a timing switch) never
    // forgets a source the owner added.
    store.update((s) => {
      const prev = s.owners[r.owner];
      s.owners[r.owner] = {
        owner: r.owner,
        evmAddress: evm_address ?? prev?.evmAddress,
        evmAddresses: evm_addresses ?? prev?.evmAddresses,
        nearAccounts: near_accounts ?? prev?.nearAccounts,
        peopleEmails: people_emails ?? prev?.peopleEmails,
        github: github ?? prev?.github,
        email: email ?? prev?.email,
        watchedSince,
      };
    });
    return c.json({ ok: true, signed: r.signed, watching: store.get().owners[r.owner] });
  });

  // Heartbeat app ping: a real, strong signal, because it is signed by a key on the owner's account
  // (a full-access key, or a device key limited to the will contract).
  app.post("/api/heartbeat", async (c) => {
    const r = await ownerRequest(await c.req.json(), "heartbeat", z.object({}).passthrough(), "A heartbeat must be signed by the owner");
    if (r.error) return c.json(r.error.body, r.error.status);
    const wait = signalLimiter.take(r.owner);
    if (wait) return c.json(tooMany(wait), 429);
    if (!(await contract.getWill(r.owner))) return c.json({ error: `No will for ${r.owner}` }, 404);
    const at = new Date().toISOString();
    store.update((s) => {
      s.heartbeats[r.owner] = at;
      s.owners[r.owner] ??= { owner: r.owner, watchedSince: at };
    });
    deps.onSignOfLife?.(r.owner);
    return c.json({ ok: true, owner: r.owner, at });
  });

  // Latest activity per source (timestamps only, never content) for the liveness timeline.
  // Latest signal per source, plus the plain-English verdict (§7.8): what counts as a sign of life,
  // what was ignored and why. Timestamps only.
  async function signalsFor(owner: string) {
    const seen = store.get().observations[owner] ?? {};
    const will = await cached(`will:${owner}`, 5000, () => contract.getWill(owner)).catch(() => null);
    const observations = Object.entries(seen).map(([source, o]) => ({ source: source as SignalSource, at: new Date(o!.at), trustWeight: o!.trustWeight, simulated: o!.simulated }));
    // The owner's usual rhythm, from their own transaction history; recomputed at most daily.
    const cfg = store.get().owners[owner];
    const baseline = will ? await usualRhythm(owner, cfg) : null;
    const verdict = will ? explainLiveness(will, observations, new Date(), undefined, baseline?.medianGapS ?? null) : null;
    return { will, signals: { observations: seen, heartbeat: store.get().heartbeats[owner] ?? null, verdict } };
  }

  app.get("/api/signals/:owner", async (c) => c.json((await signalsFor(c.req.param("owner"))).signals));

  // Everything an owner/demo page shows from the agent, in one request (instead of signals + status +
  // notifications + telegram polled separately). Shared for a few seconds across open pages.
  app.get("/api/overview/:owner", async (c) => {
    const owner = c.req.param("owner");
    const body = await cached(`overview:${owner}`, 3000, async () => {
      const { will, signals } = await signalsFor(owner);
      const s = store.get();
      return {
        status: will
          ? {
              state: stateName(will.state),
              last_alive_at: will.last_alive_at,
              watching: watchingFlags(s.owners[owner]),
              has_policy: !!s.policies[owner],
              simulated_signals: s.simulated[owner] ?? {},
            }
          : null,
        signals,
        // The name the owner chose for heirs and guardians to see (from the approved will), if any.
        display_name: s.policies[owner]?.display_name ?? null,
        notifications: publicNotifications(s.notifications.filter((n) => n.owner === owner).slice(-30), will),
        telegram: deps.telegram ? { enabled: true, bot: deps.telegram.username, linked: deps.telegram.isLinked(owner) } : { enabled: false, linked: false },
      };
    });
    return c.json(body);
  });

  // NEAR AI Cloud attestation for the configured model: public, contains no will content.
  app.get("/api/attestation/ai", async (c) => {
    if (!deps.ai) return c.json({ error: "NEAR AI is not configured (NEARAI_API_KEY)" }, 503);
    return c.json(await deps.ai.attestation());
  });

  // Plain-English will → validated draft + summary for the owner to approve. It spends our NEAR AI
  // credit and carries will content, so it must be owner-signed.
  app.post("/api/policy/draft", async (c) => {
    if (!deps.ai) return c.json({ error: "NEAR AI is not configured (NEARAI_API_KEY)" }, 503);
    const r = await ownerRequest(await c.req.json(), "draft_policy", DraftText);
    if (r.error) return c.json(r.error.body, r.error.status);
    const wait = limiters.draft.take(r.owner);
    if (wait) return c.json(tooMany(wait), 429);
    try {
      return c.json(await deps.ai.draftPolicy(r.owner, r.data.text));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  });

  // Heir claim guide. Signed by the heir (never unsigned: it spends NEAR AI credit); the model sees
  // only that heir's own claim facts.
  app.post("/api/heir/guide", async (c) => {
    if (!deps.ai) return c.json({ error: "NEAR AI is not configured (NEARAI_API_KEY)" }, 503);
    const r = await ownerRequest(await c.req.json(), "heir_guide", GuideRequest, "The guide needs a request signed by the heir");
    if (r.error) return c.json(r.error.body, r.error.status);
    const heir = r.owner;
    const will = await contract.getWill(r.data.owner);
    if (!will) return c.json({ error: `No will for ${r.data.owner}` }, 404);
    if (!will.heirs.some((h) => h.account_id === heir)) return c.json({ error: `${heir} is not an heir of this will` }, 403);
    const wait = limiters.guide.take(heir);
    if (wait) return c.json(tooMany(wait), 429);
    try {
      return c.json(await deps.ai.heirGuide(will, heir, store.get().policies[will.owner], r.data.question, r.data.history));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  });

  // The approved policy. No auth needed: it is accepted only if its hash is the will's policy_hash,
  // which only the owner can set.
  app.post("/api/policy", async (c) => {
    const body = (await c.req.json()) as { owner?: string; policy?: unknown };
    const check = checkPolicy(body.policy);
    if (!check.ok) return c.json({ errors: check.errors }, 400);
    const will = body.owner ? await contract.getWill(body.owner) : null;
    if (!will) return c.json({ error: `No will for ${body.owner}` }, 404);
    const hash = policyHash(check.policy);
    if (hash !== will.policy_hash) return c.json({ error: "Policy hash does not match the will's policy_hash", hash }, 409);
    store.update((s) => (s.policies[will.owner] = check.policy));
    return c.json({ ok: true, policy_hash: hash });
  });

  app.get("/api/vaults/:owner", async (c) => {
    const owner = c.req.param("owner");
    // Balance lookups cost Sepolia and mempool.space calls: only for wills that exist (audit round 2).
    if (!ACCOUNT_ID.test(owner)) return c.json({ error: "Not a NEAR account id" }, 400);
    if (!(await cached(`will:${owner}`, 5_000, () => contract.getWill(owner)).catch(() => null))) return c.json({ error: `No will for ${owner}` }, 404);
    const out = await cached(`vaults:${owner}`, 15_000, async () => {
      const r: Record<string, unknown> = {};
      for (const v of deps.vaults) {
        let address: string | undefined;
        try {
          address = await v.address(owner);
          r[v.chain] = { address, balance: (await v.balance(owner)).toString() };
        } catch (e) {
          // The address is derived locally, so it is still worth returning when only the balance lookup failed.
          r[v.chain] = { ...(address ? { vault: address } : {}), error: e instanceof Error ? e.message : String(e) };
        }
      }
      return r;
    });
    return c.json(out);
  });

  app.get("/api/status/:owner", async (c) => {
    const owner = c.req.param("owner");
    const will = await cached(`will:${owner}`, 5_000, () => contract.getWill(owner));
    if (!will) return c.json({ error: `No will for ${owner}` }, 404);
    const s = store.get();
    return c.json({
      state: stateName(will.state),
      will_state: will.state,
      last_alive_at: will.last_alive_at,
      watching: watchingFlags(s.owners[owner]),
      has_policy: !!s.policies[owner],
      simulated_signals: s.simulated[owner] ?? {},
    });
  });

  app.get("/api/notifications", async (c) => {
    const owner = c.req.query("owner");
    if (!owner) return c.json({ error: "owner is required" }, 400);
    const will = await cached(`will:${owner}`, 5_000, () => contract.getWill(owner)).catch(() => null);
    return c.json(publicNotifications(store.get().notifications.filter((n) => n.owner === owner), will));
  });

  // Telegram link (§7.7): a one-time t.me deep link for the signing account (owner, guardian or friend).
  // Always signed: a chat linked to someone else's account could keep their will "alive".
  app.post("/api/telegram/link", async (c) => {
    if (!deps.telegram) return c.json({ error: "Telegram is not configured on this agent" }, 503);
    const r = await ownerRequest(await c.req.json(), "telegram_link", z.object({}).passthrough(), "Linking Telegram must be signed by the account");
    if (r.error) return c.json(r.error.body, r.error.status);
    return c.json({ ok: true, account: r.owner, ...deps.telegram.issueLink(r.owner) });
  });

  app.get("/api/telegram/:account", (c) => {
    if (!deps.telegram) return c.json({ enabled: false, linked: false });
    return c.json({ enabled: true, bot: deps.telegram.username, linked: deps.telegram.isLinked(c.req.param("account")) });
  });

  // ---- NEAR Intents (§J). The agent's client is SIMULATED (NEAR Intents has no testnet). ----

  // Tokens heirs can choose to receive, with live prices (public 1Click token list).
  app.get("/api/intents/tokens", async (c) => {
    if (!deps.intents) return c.json({ enabled: false, tokens: [] });
    const tokens = await cached("intents:tokens", 60_000, () => deps.intents!.tokens());
    return c.json({ enabled: true, simulated: deps.intents.simulated, tokens: payoutTokens(tokens) });
  });

  // An heir's payout choice (§J.3). Signed by the heir: it decides where their inheritance goes.
  app.post("/api/heir/payout", async (c) => {
    if (!deps.intents) return c.json({ error: "NEAR Intents is not configured on this agent" }, 503);
    const r = await ownerRequest(await c.req.json(), "payout_pref", PayoutChoice, "A payout choice must be signed by the heir");
    if (r.error) return c.json(r.error.body, r.error.status);
    const heir = r.owner;
    const will = await contract.getWill(r.data.owner);
    if (!will) return c.json({ error: `No will for ${r.data.owner}` }, 404);
    if (!will.heirs.some((h) => h.account_id === heir)) return c.json({ error: `${heir} is not an heir of this will` }, 403);
    const tokens = await cached("intents:tokens", 60_000, () => deps.intents!.tokens());
    const pref = { blockchain: r.data.blockchain, assetId: r.data.asset_id, address: r.data.address.trim() };
    const bad = checkPayoutPref(tokens, pref);
    if (bad) return c.json({ error: bad }, 400);
    // Route probe (§J.2): only accept a choice that quotes, for about $10 from the NEAR vault.
    const near = tokens.find((t) => t.assetId === ORIGIN_ASSET.Near.assetId);
    if (near && pref.assetId !== near.assetId) {
      try {
        await deps.intents.quote(
          quoteRequest({
            dry: true,
            originAsset: near.assetId,
            destinationAsset: pref.assetId,
            amount: parseUnits((10 / near.price).toFixed(6), near.decimals).toString(),
            refundTo: will.owner,
            recipient: pref.address,
            waitMs: 3000,
          }),
        );
      } catch (e) {
        return c.json({ error: `No route to that asset right now: ${e instanceof Error ? e.message : String(e)}` }, 409);
      }
    }
    const symbol = tokens.find((t) => t.assetId === pref.assetId)!.symbol;
    store.update((s) => ((s.payoutPrefs[will.owner] ??= {})[heir] = { ...pref, symbol, setAt: new Date().toISOString() }));
    return c.json({ ok: true, simulated: deps.intents.simulated, pref: store.get().payoutPrefs[will.owner][heir] });
  });

  // Onward payouts per heir. Before any slice is released this reveals nothing: heirs stay hidden
  // (§8), so who set a payout choice is not shown until the release has started.
  app.get("/api/payouts/:owner", async (c) => {
    const owner = c.req.param("owner");
    const will = await cached(`will:${owner}`, 5_000, () => contract.getWill(owner));
    if (!will) return c.json({ error: `No will for ${owner}` }, 404);
    const s = store.get();
    const policy = s.policies[owner];
    // Heirs stay hidden (§8): only while the release is under way or done. After a halt the will is
    // back to Active and heirs are hidden again (break-it 2026-11-06).
    const revealed = REVEALED.includes(stateName(will.state));
    const base = { enabled: !!deps.intents, simulated: deps.intents?.simulated ?? true, value_mode: policy?.payout_value_mode ?? "as_is", min_usd: MIN_PAYOUT_USD };
    const slices = slicesFor(will, policy);
    if (!slices.length || !deps.intents || !revealed) return c.json({ ...base, started: false, heirs: {} });
    // Payout addresses are personal data not in contract state: shown masked.
    const mask = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
    const tokens = await cached("intents:tokens", 60_000, () => deps.intents!.tokens());
    const batches = s.payouts[owner] ?? [];
    const only = c.req.query("heir");
    const heirs: Record<string, unknown> = {};
    for (const heir of new Set(slices.map((x) => x.heir))) {
      if (only && heir !== only) continue;
      const waiting = pendingSlices(slices, batches, heir).map((x) => {
        const t = tokens.find((k) => k.assetId === ORIGIN_ASSET[x.chain].assetId);
        return { key: x.key, chain: x.chain, symbol: ORIGIN_ASSET[x.chain].symbol, amount: x.amount.toString(), usd: t ? Number(usdValue(x.amount, t).toFixed(2)) : null, exhausted: x.exhausted };
      });
      const pref = s.payoutPrefs[owner]?.[heir];
      heirs[heir] = {
        pref: pref ? { ...pref, address: mask(pref.address) } : null,
        batches: batches.filter((b) => b.heir === heir).map((b) => ({ ...b, recipient: mask(b.recipient) })),
        waiting,
      };
    }
    return c.json({ ...base, started: true, heirs });
  });

  // Fund your will from anywhere (§J.5): a quote that delivers into the will's vault from any
  // supported asset. SIMULATED here: testnet vaults can't receive through NEAR Intents.
  app.post("/api/intents/fund-quote", async (c) => {
    if (!deps.intents) return c.json({ error: "NEAR Intents is not configured on this agent" }, 503);
    const parsed = FundQuote.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    const { owner, vault, origin_asset, amount } = parsed.data;
    const wait = fundLimiter.take(owner);
    if (wait) return c.json(tooMany(wait), 429);
    if (!(await cached(`will:${owner}`, 5_000, () => contract.getWill(owner)))) return c.json({ error: `No will for ${owner}` }, 404);
    const vaultAdapter = deps.vaults.find((v) => v.chain === vault);
    if (vault !== "Near" && !vaultAdapter) return c.json({ error: `This agent has no ${vault} vault` }, 400);
    const tokens = await cached("intents:tokens", 60_000, () => deps.intents!.tokens());
    const origin = tokens.find((t) => t.assetId === origin_asset);
    if (!origin) return c.json({ error: "Unknown asset" }, 400);
    const units = parseUnits(amount, origin.decimals);
    if (units <= 0n) return c.json({ error: "Amount must be more than zero" }, 400);
    const usd = usdValue(units, origin);
    if (usd > 10_000) return c.json({ error: "Keep demo amounts under $10,000" }, 400);
    const recipient = vault === "Near" ? owner : await vaultAdapter!.address(owner);
    try {
      const q = await deps.intents.quote(
        quoteRequest({ dry: false, originAsset: origin.assetId, destinationAsset: ORIGIN_ASSET[vault].assetId, amount: units.toString(), refundTo: "your-wallet", recipient }),
      );
      return c.json({ simulated: deps.intents.simulated, vault, recipient, origin: { symbol: origin.symbol, blockchain: origin.blockchain }, quote: q.quote });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 409);
    }
  });

  // SIMULATED only: "I've sent it" for a fund-from-anywhere quote (a real deposit comes from the user's wallet).
  app.post("/api/intents/fund-sent", async (c) => {
    if (!deps.intents?.simulated) return c.json({ error: "Only the SIMULATED client takes this" }, 400);
    const { deposit_address } = (await c.req.json()) as { deposit_address?: string };
    if (!deposit_address) return c.json({ error: "deposit_address required" }, 400);
    try {
      await deps.intents.submitDeposit("SIMULATED-user-deposit", deposit_address);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
    }
  });

  app.get("/api/intents/status", async (c) => {
    if (!deps.intents) return c.json({ error: "NEAR Intents is not configured on this agent" }, 503);
    const addr = c.req.query("depositAddress");
    if (!addr) return c.json({ error: "depositAddress required" }, 400);
    try {
      return c.json({ simulated: deps.intents.simulated, ...(await deps.intents.status(addr)) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
    }
  });

  // Demo vault faucet: pool addresses (the demo heir receives at the same addresses, so coins cycle).
  app.get("/demo/faucet", (c) => {
    if (!deps.demoMode || !deps.faucet) return c.json({ enabled: false });
    const f = deps.faucet;
    return c.json({ enabled: true, eth: f.ethAddress, btc: f.btcAddress, ...f.amounts });
  });

  // Tops up an Active demo will's empty Sepolia/BTC vaults once. Owner-signed and capped per day.
  app.post("/demo/faucet", async (c) => {
    if (!deps.demoMode || !deps.faucet) return c.json({ error: "The demo faucet is not enabled" }, 403);
    const r = await ownerRequest(await c.req.json(), "demo_faucet", z.object({}).passthrough(), "The faucet needs a request signed by the will's owner");
    if (r.error) return c.json(r.error.body, r.error.status);
    const owner = r.owner;
    if (faucetBusy.has(owner)) return c.json({ error: "The faucet is already funding this will; wait a moment" }, 409);
    faucetBusy.add(owner);
    try {
      // Each chain is funded at most once per will; a chain whose send failed can be retried.
      const earlier = store.get().faucetSends[owner] ?? [];
      const will = await contract.getWill(owner);
      if (!will) return c.json({ error: `No will for ${owner}` }, 404);
      if (stateName(will.state) !== "Active") return c.json({ error: "The faucet only funds Active wills" }, 409);
      const vaults = deps.vaults.filter((v) => will.foreign_chains.includes(v.chain));
      if (!vaults.length) return c.json({ error: "This will has no Sepolia or BTC vault" }, 409);
      const chains = vaults.filter((v) => !earlier.some((s) => s.chain === v.chain));
      if (!chains.length) return c.json({ error: "This will's vaults were already funded by the faucet", sends: earlier }, 409);
      const wait = limiters.faucet.take(owner);
      if (wait) return c.json(tooMany(wait), 429);
      const sends: FaucetSend[] = [];
      const errors: string[] = [];
      for (const v of chains) {
        try {
          if ((await v.balance(owner)) > 0n) continue; // already funded some other way
          sends.push(await deps.faucet!.send(v.chain, await v.address(owner)));
        } catch (e) {
          const msg = `${v.chain}: ${e instanceof Error ? e.message : String(e)}`;
          console.error(`[faucet] ${owner} ${msg}`);
          errors.push(msg);
        }
      }
      if (sends.length) store.update((s) => (s.faucetSends[owner] = [...earlier, ...sends]));
      return c.json({ ok: errors.length === 0, sends, errors }, sends.length || !errors.length ? 200 : 503);
    } finally {
      faucetBusy.delete(owner);
    }
  });

  // SIMULATED signals for the demo panel (CLAUDE.md §7.1). Never available outside demo mode.
  app.post("/demo/signal", async (c) => {
    if (!deps.demoMode) return c.json({ error: "Simulated signals are available only in demo mode" }, 403);
    // Signed by the owner: a SIMULATED Gmail or Calendar signal (0.7) counts alone, so an unsigned
    // route would let anyone keep any demo will from ever executing (break-it 2026-11-06).
    const r = await ownerRequest(await c.req.json(), "demo_signal", DemoSignalFields, "A simulated signal must be signed by the owner");
    if (r.error) return c.json(r.error.body, r.error.status);
    const wait = signalLimiter.take(r.owner);
    if (wait) return c.json(tooMany(wait), 429);
    const { owner } = r;
    const { source, at } = r.data;
    const when = at ?? new Date().toISOString();
    store.update((s) => (s.simulated[owner] = { ...s.simulated[owner], [source]: when }));
    deps.onSignOfLife?.(owner);
    return c.json({ ok: true, simulated: true, owner, source, at: when });
  });

  return app;
}
