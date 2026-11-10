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

/** What the sign-in page needs to know (all public). */
export async function GET() {
  const p = parent();
  return Response.json({ enabled: !!p, parent: p?.id ?? null, googleClientId: env("GOOGLE_CLIENT_ID") ?? null });
}

export async function POST(req: Request) {
  const p = parent();
  if (!p) return Response.json({ error: "Onboarding is not configured on this deployment" }, { status: 503 });
  let body: { kind?: string; idToken?: string; publicKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }
  const publicKey = body.publicKey ?? "";
  try {
    if (!publicKey.startsWith("ed25519:")) throw new Error();
    PublicKey.fromString(publicKey);
  } catch {
    return Response.json({ error: "publicKey must be an ed25519 public key" }, { status: 400 });
  }

  const ip = clientIp(req);
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
    if (limited(`demo:${ip}`, 5, 3_600_000)) return Response.json({ error: "Too many demo accounts from this network; try again later" }, { status: 429 });
    id = `demo-${randomBytes(4).toString("hex")}.${p.id}`;
  } else {
    return Response.json({ error: 'kind must be "google" or "demo"' }, { status: 400 });
  }

  const amount = nearToYocto(env("ONBOARD_FUND_NEAR", "1.6")!);
  const floor = nearToYocto(env("ONBOARD_PARENT_FLOOR_NEAR", "3")!);
  const balance = BigInt((await p.provider.viewAccount(p.id)).amount);
  if (balance - amount < floor) return Response.json({ error: "Today's free testnet accounts have run out; please try again later" }, { status: 503 });

  await createFunded(p, id, publicKey, amount);
  return Response.json({ accountId: id, existed: false, fundedNear: env("ONBOARD_FUND_NEAR", "1.6") });
}
