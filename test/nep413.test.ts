import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { KeyPairSigner } from "@near-js/signers";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type KeyPermission, Nep413Verifier, type SignedAction } from "../src/auth/nep413";

const CONTRACT = "inheirit.testnet";
const NOW = 1_800_000_000_000;
const owner = KeyPair.fromRandom("ed25519");
const device = KeyPair.fromRandom("ed25519");

const keys: Record<string, KeyPermission> = {
  [owner.getPublicKey().toString()]: "FullAccess",
  [device.getPublicKey().toString()]: { FunctionCall: { receiver_id: CONTRACT, method_names: ["i_am_alive"] } },
};

function verifier() {
  return new Nep413Verifier({
    recipient: CONTRACT,
    accessKey: async (account, pk) => (account === "alice.testnet" ? (keys[pk] ?? null) : null),
    now: () => NOW,
  });
}

async function sign(
  kp: KeyPair,
  action: SignedAction,
  opts: { account?: string; owner?: string; at?: number; recipient?: string; data?: unknown } = {},
) {
  const account = opts.account ?? "alice.testnet";
  const message = JSON.stringify({ action, owner: opts.owner ?? account, issued_at: opts.at ?? NOW, data: opts.data });
  const nonce = randomBytes(32);
  const signer = KeyPairSigner.fromSecretKey(kp.toString() as KeyPairString);
  const signed = await signer.signNep413Message(message, account, opts.recipient ?? CONTRACT, nonce);
  return {
    account_id: account,
    public_key: signed.publicKey.toString(),
    signature: Buffer.from(signed.signature).toString("base64"),
    nonce: nonce.toString("base64"),
    message,
  };
}

describe("Nep413Verifier", () => {
  it("accepts a full-access key for any action and returns the data", async () => {
    const v = await verifier().verify(await sign(owner, "register_owner", { data: { github: "alice" } }), "register_owner");
    expect(v).toMatchObject({ owner: "alice.testnet", action: "register_owner", data: { github: "alice" } });
  });
  it("accepts a device key limited to the will contract for heartbeats only", async () => {
    const v = verifier();
    await expect(v.verify(await sign(device, "heartbeat"), "heartbeat")).resolves.toMatchObject({ action: "heartbeat" });
    await expect(v.verify(await sign(device, "register_owner"), "register_owner")).rejects.toThrow("full-access");
  });
  it("rejects a key that is not on the account", async () => {
    const stranger = KeyPair.fromRandom("ed25519");
    await expect(verifier().verify(await sign(stranger, "heartbeat"), "heartbeat")).rejects.toThrow("not on alice.testnet");
  });
  it("rejects a message signed for another recipient", async () => {
    await expect(verifier().verify(await sign(owner, "heartbeat", { recipient: "evil.testnet" }), "heartbeat")).rejects.toThrow("bad signature");
  });
  it("rejects a tampered message", async () => {
    const req = await sign(owner, "heartbeat");
    req.message = req.message.replace(String(NOW), String(NOW + 1));
    await expect(verifier().verify(req, "heartbeat")).rejects.toThrow("bad signature");
  });
  it("rejects acting for another owner", async () => {
    await expect(verifier().verify(await sign(owner, "heartbeat", { owner: "bob.testnet" }), "heartbeat")).rejects.toThrow("not the signing account");
  });
  it("rejects the wrong action, old messages and replays", async () => {
    const v = verifier();
    await expect(v.verify(await sign(owner, "heartbeat"), "draft_policy")).rejects.toThrow("not draft_policy");
    await expect(v.verify(await sign(owner, "heartbeat", { at: NOW - 6 * 60_000 }), "heartbeat")).rejects.toThrow("expired");
    const req = await sign(owner, "heartbeat");
    await v.verify(req, "heartbeat");
    await expect(v.verify(req, "heartbeat")).rejects.toThrow("already used");
  });
});
