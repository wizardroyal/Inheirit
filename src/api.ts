// HTTP API of the will agent. The web app (Day 4) and demo scripts use it.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { AttestationResult } from "./ai/attestation";
import type { GuideAnswer, GuideTurn } from "./ai/heir-guide";
import { AuthError, type Nep413Verifier, type SignedAction, type Verified } from "./auth/nep413";
import { AI_DRAFT_LIMIT, AI_GUIDE_LIMIT, FAUCET_LIMIT, RateLimiter } from "./auth/rate-limit";
import type { FaucetSend } from "./demo/faucet";
import type { PolicyDraft } from "./ai/policy-parser";
import type { ChainVault } from "./executor/executor";
import { stateName, type WillContract, type WillView } from "./near/will-contract";
import { checkPolicy, policyHash, type Policy } from "./policy/policy";
import { SIMULATED_SOURCES } from "./signals/adapters";
import type { Store } from "./state/store";

export interface ApiDeps {
  contract: WillContract;
  store: Store;
  vaults: ChainVault[];
  demoMode: boolean;
  agentInfo: () => Promise<Record<string, unknown>>;
  /** Checks owner-signed (NEP-413) requests. */
  auth: Pick<Nep413Verifier, "verify">;
  /** Demo vault faucet; absent unless demo mode has pool keys configured. */
  faucet?: {
    ethAddress: string;
    btcAddress: string;
    amounts: { eth_wei: string; btc_sats: number };
    send(chain: "Eth" | "Btc", to: string): Promise<FaucetSend>;
  };
  /** Override the default rate limits (tests). */
  limiters?: { draft: RateLimiter; guide: RateLimiter; faucet: RateLimiter };
  /** Absent when NEARAI_API_KEY isn't configured. */
  ai?: {
    attestation(): Promise<AttestationResult>;
    draftPolicy(owner: string, text: string): Promise<PolicyDraft>;
    heirGuide(will: WillView, heir: string, policy: Policy | undefined, question: string, history: GuideTurn[]): Promise<GuideAnswer>;
  };
}

const DraftText = z.object({ text: z.string().min(10).max(4000) });
const DraftRequest = DraftText.extend({ owner: z.string().min(2) });

const GuideRequest = z.object({
  owner: z.string().min(2),
  question: z.string().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(8).default([]),
});

const OwnerFields = z.object({
  evm_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  github: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
  email: z.string().email().optional(),
});
const OwnerConfig = OwnerFields.extend({ owner: z.string().min(2) });

const DemoSignal = z.object({
  owner: z.string().min(2),
  source: z.enum(SIMULATED_SOURCES.map((s) => s.source) as [string, ...string[]]),
  at: z.string().datetime().optional(),
});

export function api(deps: ApiDeps): Hono {
  const app = new Hono();
  app.use(cors());
  const { contract, store } = deps;
  const limiters = deps.limiters ?? {
    draft: new RateLimiter(AI_DRAFT_LIMIT),
    guide: new RateLimiter(AI_GUIDE_LIMIT),
    faucet: new RateLimiter(FAUCET_LIMIT),
  };
  const tooMany = (waitMs: number) => ({ error: "Too many requests; try again later", retry_after_s: Math.ceil(waitMs / 1000) });

  app.get("/", (c) => c.json({ message: "Inheirit will agent is running", demoMode: deps.demoMode }));
  app.get("/api/agent-info", async (c) => c.json(await deps.agentInfo()));

  // Body is either an owner-signed request ({ signed }) or, in demo mode only, plain fields.
  // Returns the owner and the payload fields, or a response to send back.
  async function ownerRequest<T extends z.ZodTypeAny>(body: unknown, action: SignedAction, fields: T, plain: z.ZodTypeAny) {
    const signed = (body as { signed?: unknown } | null)?.signed;
    if (signed) {
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
    if (!deps.demoMode) return { error: { status: 403 as const, body: { error: "This request needs an owner signature (NEP-413) outside demo mode" } } };
    const data = plain.safeParse(body);
    if (!data.success) return { error: { status: 400 as const, body: { error: data.error.issues } } };
    const { owner, ...rest } = data.data as { owner: string };
    return { owner, data: rest as z.infer<T>, signed: false };
  }

  // Which public identities to watch for an owner. Anyone could claim a GitHub handle for someone
  // else's will and keep it "alive", so it must be signed by the owner (unsigned only in demo mode).
  app.post("/api/owners", async (c) => {
    const r = await ownerRequest(await c.req.json(), "register_owner", OwnerFields, OwnerConfig);
    if (r.error) return c.json(r.error.body, r.error.status);
    const { evm_address, github, email } = r.data;
    if (!(await contract.getWill(r.owner))) return c.json({ error: `No will for ${r.owner}` }, 404);
    store.update((s) => (s.owners[r.owner] = { owner: r.owner, evmAddress: evm_address, github, email }));
    return c.json({ ok: true, signed: r.signed, watching: store.get().owners[r.owner] });
  });

  // Heartbeat app ping: a real, strong signal, because it is signed by a key on the owner's account
  // (a full-access key, or a device key limited to the will contract).
  app.post("/api/heartbeat", async (c) => {
    const body = (await c.req.json()) as { signed?: unknown };
    if (!body?.signed) return c.json({ error: "A heartbeat must be signed by the owner" }, 401);
    const r = await ownerRequest(body, "heartbeat", z.object({}).passthrough(), z.never());
    if (r.error) return c.json(r.error.body, r.error.status);
    if (!(await contract.getWill(r.owner))) return c.json({ error: `No will for ${r.owner}` }, 404);
    const at = new Date().toISOString();
    store.update((s) => {
      s.heartbeats[r.owner] = at;
      s.owners[r.owner] ??= { owner: r.owner };
    });
    return c.json({ ok: true, owner: r.owner, at });
  });

  // Latest activity per source (timestamps only, never content) for the liveness timeline.
  app.get("/api/signals/:owner", (c) => {
    const owner = c.req.param("owner");
    return c.json({ observations: store.get().observations[owner] ?? {}, heartbeat: store.get().heartbeats[owner] ?? null });
  });

  // NEAR AI Cloud attestation for the configured model: public, contains no will content.
  app.get("/api/attestation/ai", async (c) => {
    if (!deps.ai) return c.json({ error: "NEAR AI is not configured (NEARAI_API_KEY)" }, 503);
    return c.json(await deps.ai.attestation());
  });

  // Plain-English will → validated draft + summary for the owner to approve. It spends our NEAR AI
  // credit and carries will content, so it must be owner-signed (unsigned only in demo mode).
  app.post("/api/policy/draft", async (c) => {
    if (!deps.ai) return c.json({ error: "NEAR AI is not configured (NEARAI_API_KEY)" }, 503);
    const r = await ownerRequest(await c.req.json(), "draft_policy", DraftText, DraftRequest);
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
    const body = (await c.req.json()) as { signed?: unknown };
    if (!body?.signed) return c.json({ error: "The guide needs a request signed by the heir" }, 401);
    const r = await ownerRequest(body, "heir_guide", GuideRequest, z.never());
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
    const out: Record<string, unknown> = {};
    for (const v of deps.vaults) {
      try {
        out[v.chain] = { address: await v.address(owner), balance: (await v.balance(owner)).toString() };
      } catch (e) {
        out[v.chain] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return c.json(out);
  });

  app.get("/api/status/:owner", async (c) => {
    const owner = c.req.param("owner");
    const will = await contract.getWill(owner);
    if (!will) return c.json({ error: `No will for ${owner}` }, 404);
    const s = store.get();
    return c.json({
      state: stateName(will.state),
      will_state: will.state,
      last_alive_at: will.last_alive_at,
      watching: s.owners[owner] ?? null,
      has_policy: !!s.policies[owner],
      simulated_signals: s.simulated[owner] ?? {},
    });
  });

  app.get("/api/notifications", (c) => {
    const owner = c.req.query("owner");
    const all = store.get().notifications;
    return c.json(owner ? all.filter((n) => n.owner === owner) : all);
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
    const body = (await c.req.json()) as { signed?: unknown };
    if (!body?.signed) return c.json({ error: "The faucet needs a request signed by the will's owner" }, 401);
    const r = await ownerRequest(body, "demo_faucet", z.object({}).passthrough(), z.never());
    if (r.error) return c.json(r.error.body, r.error.status);
    const owner = r.owner;
    if (store.get().faucetSends[owner]) return c.json({ error: "This will's vaults were already funded by the faucet", sends: store.get().faucetSends[owner] }, 409);
    const will = await contract.getWill(owner);
    if (!will) return c.json({ error: `No will for ${owner}` }, 404);
    if (stateName(will.state) !== "Active") return c.json({ error: "The faucet only funds Active wills" }, 409);
    const chains = deps.vaults.filter((v) => will.foreign_chains.includes(v.chain));
    if (!chains.length) return c.json({ error: "This will has no Sepolia or BTC vault" }, 409);
    const wait = limiters.faucet.take(owner);
    if (wait) return c.json(tooMany(wait), 429);
    const sends: FaucetSend[] = [];
    const errors: string[] = [];
    for (const v of chains) {
      try {
        if ((await v.balance(owner)) > 0n) continue; // already funded some other way
        sends.push(await deps.faucet.send(v.chain, await v.address(owner)));
      } catch (e) {
        errors.push(`${v.chain}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (sends.length) store.update((s) => (s.faucetSends[owner] = sends));
    return c.json({ ok: errors.length === 0, sends, errors }, sends.length || !errors.length ? 200 : 503);
  });

  // SIMULATED signals for the demo panel (CLAUDE.md §7.1). Never available outside demo mode.
  app.post("/demo/signal", async (c) => {
    if (!deps.demoMode) return c.json({ error: "Simulated signals are available only in demo mode" }, 403);
    const parsed = DemoSignal.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    const { owner, source, at } = parsed.data;
    const when = at ?? new Date().toISOString();
    store.update((s) => (s.simulated[owner] = { ...s.simulated[owner], [source]: when }));
    return c.json({ ok: true, simulated: true, owner, source, at: when });
  });

  return app;
}
