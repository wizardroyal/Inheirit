// Sealed-note crypto (CLAUDE.md §7.5): libsodium sealed boxes over X25519.
// Owners seal notes to the agent's public key in the browser; after execution starts the agent
// opens each note inside the TEE and re-seals it to the heir's key. Plaintext never leaves memory.
import sodium from "libsodium-wrappers";

export interface SealedKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export const toHex = (u: Uint8Array) => Buffer.from(u).toString("hex");

function fromHex32(hex: string, what: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${what} must be 32 bytes hex`);
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/** X25519 keypair from a 32-byte seed. Zeroes the seed. */
export async function keypairFromSeed(seed: Uint8Array): Promise<SealedKeypair> {
  if (seed.length !== 32) throw new Error(`seed must be 32 bytes, got ${seed.length}`);
  await sodium.ready;
  const kp = sodium.crypto_box_seed_keypair(seed);
  sodium.memzero(seed);
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function sealTo(plaintext: string | Uint8Array, recipientPubHex: string): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_box_seal(plaintext, fromHex32(recipientPubHex, "recipient key"));
}

export async function openSealed(ciphertext: Uint8Array, kp: SealedKeypair): Promise<string> {
  await sodium.ready;
  return sodium.to_string(sodium.crypto_box_seal_open(ciphertext, kp.publicKey, kp.privateKey));
}

/**
 * What the owner's browser seals (v2): the note's text together with the will it belongs to. Without
 * this binding anyone could copy a note's public ciphertext into a throwaway will of their own, rush it
 * to SecretsReleased, and have the agent re-seal the plaintext to them (audit round 2, 2026-11-11).
 */
export interface BoundNote {
  v: 2;
  owner: string;
  heir: string;
  text: string;
}

export function bindNote(owner: string, heir: string, text: string): string {
  return JSON.stringify({ v: 2, owner, heir, text } satisfies BoundNote);
}

/** Thrown for a note that doesn't name this will's owner and heir (copied, or sealed before v2). */
export class UnboundNoteError extends Error {}

/**
 * Opens a note sealed to `kp`, checks it was written for `expect.owner`'s will and `expect.heir`, and
 * seals only its text to the heir. The plaintext buffer is zeroed after use.
 */
export async function reseal(ciphertext: Uint8Array, kp: SealedKeypair, heirPubHex: string, expect: { owner: string; heir: string }): Promise<Uint8Array> {
  await sodium.ready;
  const heirKey = fromHex32(heirPubHex, "heir key");
  const plaintext = sodium.crypto_box_seal_open(ciphertext, kp.publicKey, kp.privateKey);
  try {
    let note: Partial<BoundNote>;
    try {
      note = JSON.parse(sodium.to_string(plaintext));
    } catch {
      throw new UnboundNoteError("not a bound (v2) note");
    }
    if (note?.v !== 2 || typeof note.text !== "string") throw new UnboundNoteError("not a bound (v2) note");
    if (note.owner !== expect.owner || note.heir !== expect.heir) throw new UnboundNoteError("note was written for another will or heir");
    return sodium.crypto_box_seal(note.text, heirKey);
  } finally {
    sodium.memzero(plaintext);
  }
}
