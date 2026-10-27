// HTTP API of the will agent. The web app (Day 4) and demo scripts use it.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { ChainVault } from "./executor/executor";
import { stateName, type WillContract } from "./near/will-contract";
import { checkPolicy, policyHash } from "./policy/policy";
import { SIMULATED_SOURCES } from "./signals/adapters";
import type { Store } from "./state/store";

export interface ApiDeps {
  contract: WillContract;
  store: Store;
  vaults: ChainVault[];
  demoMode: boolean;
  agentInfo: () => Promise<Record<string, unknown>>;
}

const OwnerConfig = z.object({
  owner: z.string().min(2),
  evm_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  github: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
  email: z.string().email().optional(),
});

const DemoSignal = z.object({
  owner: z.string().min(2),
  source: z.enum(SIMULATED_SOURCES.map((s) => s.source) as [string, ...string[]]),
  at: z.string().datetime().optional(),
});

export function api(deps: ApiDeps): Hono {
  const app = new Hono();
  app.use(cors());
  const { contract, store } = deps;

  app.get("/", (c) => c.json({ message: "Inheirit will agent is running", demoMode: deps.demoMode }));
  app.get("/api/agent-info", async (c) => c.json(await deps.agentInfo()));

  // Which public identities to watch for an owner. Anyone could claim a GitHub handle for someone
  // else's will and keep it "alive", so outside demo mode this must be owner-signed (NEP-413,
  // with the web app on Day 4). Until then it is demo-only.
  app.post("/api/owners", async (c) => {
    if (!deps.demoMode) return c.json({ error: "Owner registration needs an owner signature (not implemented yet); demo mode only" }, 403);
    const parsed = OwnerConfig.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    const { owner, evm_address, github, email } = parsed.data;
    if (!(await contract.getWill(owner))) return c.json({ error: `No will for ${owner}` }, 404);
    store.update((s) => (s.owners[owner] = { owner, evmAddress: evm_address, github, email }));
    return c.json({ ok: true, watching: store.get().owners[owner] });
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
