"use client";
// Test receive addresses for generated heirs, so nobody has to paste a Sepolia or BTC testnet address.
// The first generated heir gets the demo faucet pool's addresses (released test coins flow back to the
// pool, like the generated sample will); every other heir gets a fresh key made here, kept in this
// browser only. Testnet only: these keys protect test coins, nothing more.
import { secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";

const STORE = "inheirit:test-wallets";

export interface TestReceive {
  eth: string;
  btc: string;
}

/** EIP-55 checksummed address of a secp256k1 public key. */
function ethAddress(pub: Uint8Array): string {
  const hex = bytesToHex(keccak_256(pub.slice(1)).slice(-20));
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(hex)));
  return "0x" + [...hex].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}

// BIP-173 bech32 (segwit v0), enough for a P2WPKH address.
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
}
function toWords(data: Uint8Array): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const b of data) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}
function bech32(hrp: string, words: number[]): string {
  const expand = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...expand, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...words, ...checksum].map((w) => CHARSET[w]).join("");
}
/** Testnet P2WPKH (tb1q…) address of a compressed public key. */
function btcAddress(compressed: Uint8Array): string {
  return bech32("tb", [0, ...toWords(ripemd160(sha256(compressed)))]);
}

/** A fresh key and its Sepolia and BTC testnet addresses; the key is saved in this browser. */
export function newTestReceive(): TestReceive {
  const priv = secp256k1.utils.randomPrivateKey();
  const out = { eth: ethAddress(secp256k1.getPublicKey(priv, false)), btc: btcAddress(secp256k1.getPublicKey(priv, true)) };
  try {
    const all = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, string>;
    all[out.eth] = bytesToHex(priv);
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // storage blocked: the addresses still work, the test coins just can't be recovered later
  }
  return out;
}

/** Receive addresses for a newly generated heir: the faucet pool's if no other heir here uses them, else fresh ones. */
export function testReceiveFor(taken: string[], pool: { eth: string; btc: string } | null): TestReceive {
  if (pool && !taken.some((a) => a.toLowerCase() === pool.eth.toLowerCase())) return { eth: pool.eth, btc: pool.btc };
  return newTestReceive();
}

export const _test = { ethAddress, btcAddress };
