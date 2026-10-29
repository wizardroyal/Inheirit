"use client";
// Sealed notes in the browser (CLAUDE.md §7.5), the same libsodium sealed boxes as the agent's
// src/sealed/crypto.ts. Owners seal to the agent's TEE key; heirs open what the agent re-sealed to them.
import sodium from "libsodium-wrappers";

export interface X25519Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function ready() {
  await sodium.ready;
  return sodium;
}

export async function sealToBase64(plaintext: string, recipientPubHex: string): Promise<string> {
  const s = await ready();
  return s.to_base64(s.crypto_box_seal(plaintext, s.from_hex(recipientPubHex)), s.base64_variants.ORIGINAL);
}

export async function newSeedHex(): Promise<string> {
  const s = await ready();
  return s.to_hex(s.randombytes_buf(32));
}

export async function keypairFromSeedHex(seedHex: string): Promise<X25519Keypair> {
  const s = await ready();
  const kp = s.crypto_box_seed_keypair(s.from_hex(seedHex));
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function pubkeyHex(kp: X25519Keypair): Promise<string> {
  return (await ready()).to_hex(kp.publicKey);
}

/** Opens a note re-sealed to the heir. Throws if it wasn't sealed to this key. */
export async function openReleased(ciphertextB64: string, kp: X25519Keypair): Promise<string> {
  const s = await ready();
  const ct = s.from_base64(ciphertextB64, s.base64_variants.ORIGINAL);
  return s.to_string(s.crypto_box_seal_open(ct, kp.publicKey, kp.privateKey));
}
