// Creates testnet accounts for people without a NEAR wallet (CLAUDE.md §13A.1):
//   google: <id>.inheirit-users.testnet, <id> derived from the verified Google `sub` (never the email)
//   demo:   demo-<random>.inheirit-users.testnet, for "Try with a demo account"
// The browser generates the key pair and sends only the public key, so this server never holds a user
// key. The parent account holds onboarding funds only and has no key on the will contract.
import { createHash, randomBytes } from "node:crypto";
import { Account } from "@near-js/accounts";
import { PublicKey, type KeyPairString } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { createRemoteJWKSet, jwtVerify } from "jose";

export const runtime = "nodejs";
// Creating a cast is six sequential transactions
export const maxDuration = 60;

const YOCTO = 10n ** 24n;
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const env = (k: string, d?: string) => process.env[k] || d;

function nearToYocto(near: string): bigint {
  const [whole, frac = ""] = near.split(".");
  return BigInt(whole || "0") * YOCTO + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

// Per-instance limits. The Vercel Firewall rule on this path is the cross-instance limit, and the
// parent's balance floor is the hard global cap.
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  hits.set(key, recent);
  return false;
}

// A global budget per instance: however many IPs ask, at most ONBOARD_HOURLY_NEAR leaves the parent each
// hour from one instance (break-it pass 2, F2). In memory, like the per-IP limits.
let spent: { windowStart: number; yocto: bigint } = { windowStart: 0, yocto: 0n };
function overBudget(amount: bigint): boolean {
  const now = Date.now();
  if (now - spent.windowStart >= 3_600_000) spent = { windowStart: now, yocto: 0n };
  if (spent.yocto + amount > nearToYocto(env("ONBOARD_HOURLY_NEAR", "80")!)) return true;
  spent.yocto += amount;
  return false;
}
const BUDGET_GONE = "This hour's free testnet NEAR has run out; please try again in a little while";

// Accounts topped up by this instance in the last day: one top-up per account.
const toppedUp = new Map<string, number>();

function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

function parent(): { id: string; account: Account; provider: JsonRpcProvider } | null {
  const id = env("ONBOARD_PARENT_ACCOUNT");
  const key = env("ONBOARD_PARENT_KEY");
  if (!id || !key) return null;
  const provider = new JsonRpcProvider({ url: env("NEAR_RPC_URL", "https://test.rpc.fastnear.com")! });
  return { id, account: new Account(id, provider, KeyPairSigner.fromSecretKey(key as KeyPairString)), provider };
}

async function exists(provider: JsonRpcProvider, id: string): Promise<boolean> {
  try {
    await provider.viewAccount(id);
    return true;
  } catch {
    return false;
  }
}

/** createAccount with retries: concurrent requests share the parent key, so a nonce can collide. */
async function createFunded(p: NonNullable<ReturnType<typeof parent>>, id: string, publicKey: string, amount: bigint) {
  for (let attempt = 0; ; attempt++) {
    try {
      await p.account.createAccount(id, PublicKey.fromString(publicKey), amount);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < 3 && /nonce|expired|timeout/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
        if (await exists(p.provider, id)) return;
        continue;
      }
      throw e;
    }
  }
}

/**
 * Wallet users bring their own account; one that holds almost nothing gets topped up to the onboarding
 * amount so it can create a will and fund its vault. Same exposure as a demo account, same limits.
 */
async function topUp(p: NonNullable<ReturnType<typeof parent>>, ip: string, accountId: string) {
  if (!/^[a-z0-9._-]{2,64}$/.test(accountId) || (!accountId.endsWith(".testnet") && !/^[0-9a-f]{64}$/.test(accountId))) {
    return Response.json({ error: "accountId must be a testnet account" }, { status: 400 });
  }
  if (Date.now() - (toppedUp.get(accountId) ?? 0) < 86_400_000) return Response.json({ error: "This account was already topped up today" }, { status: 429 });
  if (limited(`topup:${ip}`, 3, 3_600_000)) return Response.json({ error: "Too many top-ups from this network; try again later" }, { status: 429 });
  let have: bigint;
  try {
    have = BigInt((await p.provider.viewAccount(accountId)).amount);
  } catch {
    return Response.json({ error: `${accountId} doesn't exist on testnet` }, { status: 404 });
  }
  const target = nearToYocto(env("ONBOARD_FUND_NEAR", "1.5")!);
  if (have >= nearToYocto("0.5")) return Response.json({ error: "This account already has testnet NEAR; top-ups are for empty accounts" }, { status: 409 });
  const amount = target - have;
  const floor = nearToYocto(env("ONBOARD_PARENT_FLOOR_NEAR", "3")!);
  if (BigInt((await p.provider.viewAccount(p.id)).amount) - amount < floor) {
    return Response.json({ error: "Today's free testnet NEAR has run out; please try again later" }, { status: 503 });
  }
  if (overBudget(amount)) return Response.json({ error: BUDGET_GONE }, { status: 503 });
  toppedUp.set(accountId, Date.now());
  if (toppedUp.size > 10_000) toppedUp.clear();
  await p.account.transfer({ receiverId: accountId, amount });
  return Response.json({ accountId, toppedUpTo: env("ONBOARD_FUND_NEAR", "1.5") });
}

const CAST_ROLES = ["heir", "g1", "g2", "g3", "friend", "lawyer"] as const;

/**
 * A test cast for a wallet owner: wallets (rightly) refuse to add full-access keys to new subaccounts, so
 * these accounts are made here instead, each from a public key generated in the owner's browser.
 */
async function cast(p: NonNullable<ReturnType<typeof parent>>, ip: string, publicKeys: Record<string, string> | undefined) {
  if (!publicKeys || CAST_ROLES.some((r) => !isPublicKey(publicKeys[r]))) {
    return Response.json({ error: `publicKeys must hold an ed25519 key for each of ${CAST_ROLES.join(", ")}` }, { status: 400 });
  }
  if (limited(`cast:${ip}`, 3, 3_600_000)) return Response.json({ error: "Too many casts from this network; try again later" }, { status: 429 });
  const each = nearToYocto("0.1");
  const floor = nearToYocto(env("ONBOARD_PARENT_FLOOR_NEAR", "3")!);
  if (BigInt((await p.provider.viewAccount(p.id)).amount) - each * BigInt(CAST_ROLES.length) < floor) {
    return Response.json({ error: "Today's free testnet accounts have run out; please try again later" }, { status: 503 });
  }
  if (overBudget(each * BigInt(CAST_ROLES.length))) return Response.json({ error: BUDGET_GONE }, { status: 503 });
  const tag = randomBytes(4).toString("hex");
  const accounts: Record<string, string> = {};
  // One after another: they share the parent key, so parallel sends would collide on its nonce.
  for (const r of CAST_ROLES) {
    accounts[r] = `${r}-${tag}.${p.id}`;
    await createFunded(p, accounts[r], publicKeys[r], each);
  }
  return Response.json({ accounts });
}

/** One person for a wallet owner's will (an heir, guardian, friend or lawyer), from a browser-made key. */
async function person(p: NonNullable<ReturnType<typeof parent>>, ip: string, publicKey: string) {
  if (!isPublicKey(publicKey)) return Response.json({ error: "publicKey must be an ed25519 public key" }, { status: 400 });
  if (limited(`person:${ip}`, 12, 3_600_000)) return Response.json({ error: "Too many accounts from this network; try again later" }, { status: 429 });
  const each = nearToYocto("0.1");
  const floor = nearToYocto(env("ONBOARD_PARENT_FLOOR_NEAR", "3")!);
  if (BigInt((await p.provider.viewAccount(p.id)).amount) - each < floor) {
    return Response.json({ error: "Today's free testnet accounts have run out; please try again later" }, { status: 503 });
  }
  if (overBudget(each)) return Response.json({ error: BUDGET_GONE }, { status: 503 });
  const accountId = `p-${randomBytes(5).toString("hex")}.${p.id}`;
  await createFunded(p, accountId, publicKey, each);
  return Response.json({ accountId });
}

function isPublicKey(k: unknown): k is string {
  if (typeof k !== "string" || !k.startsWith("ed25519:")) return false;
  try {
    PublicKey.fromString(k);
    return true;
  } catch {
    return false;
  }
}

/** What the sign-in page needs to know (all public). */
export async function GET() {
  const p = parent();
  return Response.json({ enabled: !!p, parent: p?.id ?? null, googleClientId: env("GOOGLE_CLIENT_ID") ?? null });
}

export async function POST(req: Request) {
  const p = parent();
  if (!p) return Response.json({ error: "Onboarding is not configured on this deployment" }, { status: 503 });
  let body: { kind?: string; idToken?: string; publicKey?: string; accountId?: string; publicKeys?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }
  const ip = clientIp(req);
  if (body.kind === "topup") return topUp(p, ip, body.accountId ?? "");
  if (body.kind === "cast") return cast(p, ip, body.publicKeys);
  if (body.kind === "person") return person(p, ip, body.publicKey ?? "");
  const publicKey = body.publicKey ?? "";
  if (!isPublicKey(publicKey)) return Response.json({ error: "publicKey must be an ed25519 public key" }, { status: 400 });

  let id: string;
  if (body.kind === "google") {
    const clientId = env("GOOGLE_CLIENT_ID");
    if (!clientId) return Response.json({ error: "Google sign-in is not configured" }, { status: 503 });
    if (limited(`google:${ip}`, 10, 3_600_000)) return Response.json({ error: "Too many sign-ups from this network; try again later" }, { status: 429 });
    let sub: string;
    try {
      const { payload } = await jwtVerify(body.idToken ?? "", GOOGLE_JWKS, {
        audience: clientId,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      });
      if (!payload.sub) throw new Error("no sub");
      // The browser asked Google to sign sha256(publicKey) into the token, so a leaked token can't be
      // used to create this person's account with someone else's key (break-it pass 2, F5).
      if (payload.nonce !== createHash("sha256").update(publicKey).digest("hex")) throw new Error("nonce mismatch");
      sub = payload.sub;
    } catch {
      return Response.json({ error: "Google sign-in could not be verified" }, { status: 401 });
    }
    // A stable, non-reversible name per Google account; the email never goes on-chain.
    id = `g${createHash("sha256").update(`inheirit-users:${sub}`).digest("hex").slice(0, 16)}.${p.id}`;
    if (await exists(p.provider, id)) {
      // We never hold user keys, so a new browser can't take over an existing account.
      return Response.json({ accountId: id, existed: true });
    }
  } else if (body.kind === "demo") {
    // Judges behind one network share this, and the control panel's casts use it too.
    if (limited(`demo:${ip}`, 8, 3_600_000)) return Response.json({ error: "Too many demo accounts from this network; try again later" }, { status: 429 });
    id = `demo-${randomBytes(4).toString("hex")}.${p.id}`;
  } else {
    return Response.json({ error: 'kind must be "google", "demo", "topup", "cast" or "person"' }, { status: 400 });
  }

  const amount = nearToYocto(env("ONBOARD_FUND_NEAR", "1.5")!);
  const floor = nearToYocto(env("ONBOARD_PARENT_FLOOR_NEAR", "3")!);
  const balance = BigInt((await p.provider.viewAccount(p.id)).amount);
  if (balance - amount < floor) return Response.json({ error: "Today's free testnet accounts have run out; please try again later" }, { status: 503 });
  if (overBudget(amount)) return Response.json({ error: BUDGET_GONE }, { status: 503 });

  await createFunded(p, id, publicKey, amount);
  return Response.json({ accountId: id, existed: false, fundedNear: env("ONBOARD_FUND_NEAR", "1.5") });
}
