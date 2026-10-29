// Owner-signed requests (NEP-413 "signMessage"). The web app signs a JSON message with a key on the
// owner's NEAR account; the agent checks the signature, then asks the chain whether that key really
// belongs to the account. Full-access keys can do anything; a function-call key limited to the will
// contract (a heartbeat device key) can only send heartbeats.
import { PublicKey } from "@near-js/crypto";
import { serialize } from "borsh";
import { createHash } from "node:crypto";
import { z } from "zod";

export type SignedAction = "heartbeat" | "register_owner" | "draft_policy" | "heir_guide";

export const SignedRequest = z.object({
  account_id: z.string().min(2),
  public_key: z.string().startsWith("ed25519:"),
  /** base64 */
  signature: z.string().min(1),
  /** base64 of 32 bytes */
  nonce: z.string().min(1),
  /** The signed JSON message: { action, owner, issued_at (ms), data }. `owner` is the signing account. */
  message: z.string().max(8000),
});
export type SignedRequest = z.infer<typeof SignedRequest>;

const Message = z.object({
  action: z.enum(["heartbeat", "register_owner", "draft_policy", "heir_guide"]),
  owner: z.string().min(2),
  issued_at: z.number().int(),
  data: z.unknown().optional(),
});

export type KeyPermission = "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[] } };

export interface AuthDeps {
  /** Contract the messages are addressed to (NEP-413 recipient), and that device keys must be limited to. */
  recipient: string;
  /** Permission of public_key on account_id, or null if the account has no such key. */
  accessKey(accountId: string, publicKey: string): Promise<KeyPermission | null>;
  now?: () => number;
}

export interface Verified {
  owner: string;
  action: SignedAction;
  issuedAt: number;
  data: unknown;
}

/** Messages older or further in the future than this are refused. */
export const MAX_AGE_MS = 5 * 60_000;
const NEP413_TAG = 2147484061; // 2^31 + 413
// NEP-413 payload layout (field order matters for borsh); @near-js/signers doesn't export its copy
const Nep413MessageSchema = {
  struct: {
    message: "string",
    nonce: { array: { type: "u8", len: 32 } },
    recipient: "string",
    callbackUrl: { option: "string" },
  },
} as const;

export function nep413Hash(message: string, recipient: string, nonce: Uint8Array): Uint8Array {
  const body = serialize(Nep413MessageSchema, { message, nonce, recipient, callbackUrl: undefined });
  const tag = serialize("u32", NEP413_TAG);
  return createHash("sha256").update(tag).update(body).digest();
}

export class Nep413Verifier {
  /** Nonces seen within MAX_AGE_MS, so a captured request can't be replayed. */
  private readonly seen = new Map<string, number>();
  constructor(private readonly deps: AuthDeps) {}

  async verify(input: unknown, expected: SignedAction): Promise<Verified> {
    const req = SignedRequest.parse(input);
    const now = (this.deps.now ?? Date.now)();
    const nonce = Buffer.from(req.nonce, "base64");
    if (nonce.length !== 32) throw new AuthError("nonce must be 32 bytes");

    const pk = PublicKey.fromString(req.public_key);
    const hash = nep413Hash(req.message, this.deps.recipient, nonce);
    if (!pk.verify(hash, Buffer.from(req.signature, "base64"))) throw new AuthError("bad signature");

    let msg: z.infer<typeof Message>;
    try {
      msg = Message.parse(JSON.parse(req.message));
    } catch {
      throw new AuthError("message is not a valid request");
    }
    if (msg.action !== expected) throw new AuthError(`message is for ${msg.action}, not ${expected}`);
    if (msg.owner !== req.account_id) throw new AuthError("message owner is not the signing account");
    if (Math.abs(now - msg.issued_at) > MAX_AGE_MS) throw new AuthError("message expired");

    this.prune(now);
    if (this.seen.has(req.nonce)) throw new AuthError("nonce already used");

    const permission = await this.deps.accessKey(req.account_id, req.public_key);
    if (!permission) throw new AuthError(`key is not on ${req.account_id}`);
    if (permission !== "FullAccess") {
      const deviceKey = permission.FunctionCall.receiver_id === this.deps.recipient;
      if (!(deviceKey && expected === "heartbeat")) throw new AuthError("this action needs a full-access key");
    }

    this.seen.set(req.nonce, now);
    return { owner: msg.owner, action: msg.action, issuedAt: msg.issued_at, data: msg.data };
  }

  private prune(now: number) {
    for (const [n, at] of this.seen) if (now - at > MAX_AGE_MS) this.seen.delete(n);
  }
}

export class AuthError extends Error {}

/** view_access_key over NEAR JSON-RPC. */
export function rpcAccessKey(rpcUrl: string, fetchImpl: typeof fetch = fetch): AuthDeps["accessKey"] {
  return async (accountId, publicKey) => {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "auth",
        method: "query",
        params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey },
      }),
    });
    if (!res.ok) throw new Error(`NEAR RPC ${res.status}`);
    const body = (await res.json()) as {
      result?: { permission?: KeyPermission; error?: string };
      error?: { cause?: { name?: string } };
    };
    const cause = body.error?.cause?.name;
    if (cause === "UNKNOWN_ACCESS_KEY" || cause === "UNKNOWN_ACCOUNT") return null;
    // Some RPCs report a missing key inside result: "access key … does not exist while viewing"
    if (body.result?.error?.includes("does not exist")) return null;
    if (!body.result?.permission) throw new Error(`NEAR RPC view_access_key failed: ${JSON.stringify(body.error ?? body)}`);
    return body.result.permission;
  };
}
