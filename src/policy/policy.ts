// The will policy (CLAUDE.md §7.6): the off-chain JSON whose sha256 is the will's policy_hash.
// The contract enforces NEAR shares, stages and guardians itself; the policy adds what the
// contract cannot see: foreign-chain shares and heirs' receive addresses.
// @noble/hashes rather than node:crypto: the web app imports this file too, so both hash the same way
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { z } from "zod";

export const ASSETS = ["NEAR", "ETH", "BTC"] as const;
export type Asset = (typeof ASSETS)[number];

const heirId = z.string().regex(/^[a-z0-9_-]{1,32}$/, "heir id: lowercase letters, digits, _ or -");
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "EVM address");
// Testnet P2WPKH / P2TR bech32 addresses (tb1...). Mainnet (bc1) is rejected on purpose.
const btcTestnetAddress = z.string().regex(/^tb1[02-9ac-hj-np-z]{8,87}$/, "BTC testnet bech32 address (tb1…)");

export const PolicySchema = z.object({
  version: z.literal(1),
  owner: z.string().min(2),
  heirs: z
    .array(
      z.object({
        id: heirId,
        name: z.string().min(1).max(64),
        near_account: z.string().min(2),
        receive: z.object({ eth: evmAddress.optional(), btc: btcTestnetAddress.optional() }).default({}),
      }),
    )
    .min(1)
    .max(10),
  allocations: z
    .array(z.object({ asset: z.enum(ASSETS), shares: z.record(heirId, z.number().int().min(0).max(100)) }))
    .min(1),
  conditions: z
    .array(
      z.object({
        heir: heirId,
        asset: z.enum(ASSETS),
        type: z.literal("not_before"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z.string().max(200).optional(),
      }),
    )
    .default([]),
  stages_pct: z.array(z.number().int().min(1).max(100)).min(1).max(10),
  guardians: z.array(z.string().min(2)).min(1).max(10),
  guardian_threshold: z.number().int().min(1),
  contacts: z.array(z.string().min(1)).max(10).default([]),
  /** May attest a death proof (speeds up the remaining release) and is in the welfare chain. */
  lawyer: z.string().min(2).optional(),
  /** Minimal sign-up (CLAUDE.md §8): a display name, optional jurisdiction. Off-chain, hashed. */
  display_name: z.string().min(1).max(64).optional(),
  jurisdiction: z.string().min(1).max(64).optional(),
  /**
   * §J.4: "stable" converts each released slice to a USD stablecoin on the heir's chosen chain (NEAR
   * Intents). Optional, so policies without it keep their hash.
   */
  payout_value_mode: z.enum(["as_is", "stable"]).optional(),
});

export type Policy = z.infer<typeof PolicySchema>;

export type PolicyCheck = { ok: true; policy: Policy } | { ok: false; errors: string[] };

/**
 * Parses and checks a policy deterministically. Never fixes anything silently: every problem is
 * returned as an error for the owner to resolve (CLAUDE.md §7.6).
 */
export function checkPolicy(input: unknown): PolicyCheck {
  const parsed = PolicySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "policy"}: ${i.message}`) };
  }
  const p = parsed.data;
  const errors: string[] = [];
  const ids = new Set(p.heirs.map((h) => h.id));
  if (ids.size !== p.heirs.length) errors.push("heirs: duplicate heir id");
  const accounts = new Set(p.heirs.map((h) => h.near_account));
  if (accounts.size !== p.heirs.length) errors.push("heirs: duplicate near_account");

  // Foreign execution records name only the receive address, so two heirs sharing one would be
  // indistinguishable (one would look already paid). Break-it 2026-11-06.
  for (const chain of ["eth", "btc"] as const) {
    const addrs = p.heirs.map((h) => h.receive[chain]?.toLowerCase()).filter(Boolean);
    if (new Set(addrs).size !== addrs.length) errors.push(`heirs: two heirs share a receive.${chain} address`);
  }

  const seenAssets = new Set<Asset>();
  for (const a of p.allocations) {
    if (seenAssets.has(a.asset)) errors.push(`allocations: ${a.asset} listed twice`);
    seenAssets.add(a.asset);
    const sum = Object.values(a.shares).reduce((s, v) => s + v, 0);
    if (sum !== 100) errors.push(`allocations.${a.asset}: shares sum to ${sum}, not 100`);
    for (const [id, share] of Object.entries(a.shares)) {
      const heir = p.heirs.find((h) => h.id === id);
      if (!heir) {
        errors.push(`allocations.${a.asset}: unknown heir "${id}"`);
        continue;
      }
      if (share > 0 && a.asset === "ETH" && !heir.receive.eth) errors.push(`heirs.${id}: needs receive.eth for an ETH share`);
      if (share > 0 && a.asset === "BTC" && !heir.receive.btc) errors.push(`heirs.${id}: needs receive.btc for a BTC share`);
    }
  }
  if (!seenAssets.has("NEAR")) errors.push("allocations: NEAR is required (the contract splits its NEAR vault by these shares)");
  for (const c of p.conditions) {
    if (!ids.has(c.heir)) errors.push(`conditions: unknown heir "${c.heir}"`);
  }
  const stageSum = p.stages_pct.reduce((s, v) => s + v, 0);
  if (stageSum !== 100) errors.push(`stages_pct: sums to ${stageSum}, not 100`);
  if (p.guardian_threshold > p.guardians.length) errors.push("guardian_threshold: more than the number of guardians");
  if (new Set(p.guardians).size !== p.guardians.length) errors.push("guardians: duplicate guardian");
  for (const g of p.guardians) {
    if (accounts.has(g)) errors.push(`guardians: ${g} is also an heir`);
    if (g === p.owner) errors.push("guardians: the owner cannot be a guardian");
  }
  if (p.lawyer && accounts.has(p.lawyer)) errors.push(`lawyer: ${p.lawyer} is also an heir`);
  if (p.lawyer && p.lawyer === p.owner) errors.push("lawyer: the owner cannot be the lawyer");
  return errors.length ? { ok: false, errors } : { ok: true, policy: p };
}

/** JSON with object keys sorted recursively and no whitespace. The web app must hash the same way. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hex sha256 of the canonical policy JSON: the will's on-chain policy_hash. */
export function policyHash(policy: Policy): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(policy))));
}

/** Shares (percent) of `asset` per heir id; empty if the policy does not allocate that asset. */
export function sharesFor(policy: Policy, asset: Asset): Record<string, number> {
  return policy.allocations.find((a) => a.asset === asset)?.shares ?? {};
}

/** NEAR shares in basis points per NEAR account, as the contract's create_will expects. */
export function nearShareBps(policy: Policy): Record<string, number> {
  const shares = sharesFor(policy, "NEAR");
  return Object.fromEntries(policy.heirs.map((h) => [h.near_account, (shares[h.id] ?? 0) * 100]));
}

/**
 * The plain-English summary the owner approves before policy_hash goes on-chain. Built by code from the
 * validated policy, never by the model, so what the owner reads is exactly what will be enforced.
 */
export function summarizePolicy(p: Policy): string[] {
  const lines: string[] = [];
  for (const h of p.heirs) {
    const parts: string[] = [];
    for (const a of p.allocations) {
      const share = a.shares[h.id] ?? 0;
      if (share === 0) continue;
      const to = a.asset === "ETH" ? ` (to ${h.receive.eth})` : a.asset === "BTC" ? ` (to ${h.receive.btc})` : "";
      parts.push(`${share}% of your ${a.asset}${to}`);
    }
    lines.push(`${h.name} (${h.near_account}) receives ${parts.length ? parts.join(", ") : "nothing"}.`);
  }
  const stages = p.stages_pct.map((s) => `${s}%`).join(", ");
  lines.push(
    `Released in ${p.stages_pct.length} stage${p.stages_pct.length > 1 ? "s" : ""}: ${stages}, with the longest wait after the first. Any sign of life between stages stops the rest.`,
  );
  lines.push("Sealed notes are released last: only after everything is distributed and a buffer passes.");
  lines.push(
    `Guardians: ${p.guardians.join(", ")}. Each must accept the role, and ${p.guardian_threshold} of ${p.guardians.length} must confirm before anything is released.`,
  );
  if (p.contacts.length) lines.push(`Welfare-check contacts: ${p.contacts.join(", ")}.`);
  if (p.payout_value_mode === "stable")
    lines.push("Stable value: each slice is converted to US dollar stablecoins (USDC) as it is released, on the chain each heir chooses.");
  if (p.lawyer) lines.push(`Lawyer: ${p.lawyer}. A death proof from them can speed up the remaining release, never skip it.`);
  for (const c of p.conditions) {
    const name = p.heirs.find((h) => h.id === c.heir)?.name ?? c.heir;
    lines.push(`Condition (shown, not enforced yet): ${c.asset} to ${name} not before ${c.date}${c.note ? ` (${c.note})` : ""}.`);
  }
  return lines;
}
