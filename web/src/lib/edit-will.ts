"use client";
// In-place edits on My will (round 5): heirs and shares, guardians and how many must confirm, lawyer and
// friends. One update_will per save. When this browser holds the approved policy, it's updated to match
// and sent to the agent, so the Ethereum and Bitcoin shares follow the same people and percentages.
import { checkPolicy, policyHash, type Policy } from "@agent/policy/policy";
import { agent } from "./agent";
import { DEMO_SCHEDULE, REAL_SCHEDULE } from "./config";
import { savePolicy, savedPolicy } from "./demo";
import { call, nearToYocto, signRequest } from "./near";
import { configFromWill, isSpeedrun } from "./speedrun";
import type { Will } from "./will";

export interface WillPeople {
  heirs: { account_id: string; name: string; pct: number; eth?: string; btc?: string }[];
  guardians: string[];
  threshold: number;
  lawyer: string | null;
  contacts: string[];
}

export function peopleOf(w: Will): WillPeople {
  const policy = savedPolicy(w.owner);
  return {
    heirs: w.heirs.map((h) => {
      const p = policy?.heirs.find((x) => x.near_account === h.account_id);
      return { account_id: h.account_id, name: h.name, pct: h.near_share_bps / 100, eth: p?.receive.eth, btc: p?.receive.btc };
    }),
    guardians: w.guardians.map((g) => g.account_id),
    threshold: w.guardian_threshold,
    lawyer: w.lawyer,
    contacts: w.contacts,
  };
}

export async function saveWillPeople(w: Will, next: WillPeople): Promise<void> {
  const total = next.heirs.reduce((s, h) => s + h.pct, 0);
  if (Math.round(total) !== 100) throw new Error(`Shares add up to ${total}%; they must make 100%.`);
  if (next.threshold < 1 || next.threshold > next.guardians.length) throw new Error(`How many must confirm: 1 to ${next.guardians.length}.`);
  const preset = isSpeedrun(w) ? DEMO_SCHEDULE : { ...REAL_SCHEDULE, timings: { ...REAL_SCHEDULE.timings, quiet_after: w.timings.quiet_after } };
  const config = configFromWill(w, preset);
  // Keep the will's own waits (configFromWill rebuilds them from the preset).
  config.stages = w.stages;
  config.accelerated_stages = w.accelerated_stages;
  config.timings = w.timings;
  config.heirs = next.heirs.map((h) => ({ account_id: h.account_id, name: h.name, near_share_bps: Math.round(h.pct * 100) }));
  config.guardians = next.guardians;
  config.guardian_threshold = next.threshold;
  config.lawyer = next.lawyer;
  config.contacts = next.contacts;

  const old = savedPolicy(w.owner);
  // Did who inherits, or their shares, change? Only then are the Ethereum and Bitcoin splits touched; an
  // edit of guardians or friends keeps every asset's own split (audit 2026-11-13).
  const before = peopleOf(w).heirs.map((h) => `${h.account_id}:${h.pct}`).join(",");
  const heirsChanged = before !== next.heirs.map((h) => `${h.account_id}:${h.pct}`).join(",");
  if (!old && heirsChanged && w.foreign_chains.length) {
    throw new Error("This will's Ethereum and Bitcoin split is kept in the browser that created it. Change heirs there, so every chain follows the same people.");
  }
  let policy: Policy | null = null;
  if (old) {
    const ids = next.heirs.map((h) => old.heirs.find((x) => x.near_account === h.account_id)?.id ?? `h_${h.account_id.split(".")[0].replace(/[^a-z0-9]/g, "")}`);
    const shares = Object.fromEntries(next.heirs.map((h, i) => [ids[i], h.pct]));
    const draft = {
      ...old,
      heirs: next.heirs.map((h, i) => ({ id: ids[i], name: h.name, near_account: h.account_id, receive: { ...(h.eth ? { eth: h.eth } : {}), ...(h.btc ? { btc: h.btc } : {}) } })),
      allocations: heirsChanged ? old.allocations.map((a) => ({ ...a, shares })) : old.allocations,
      guardians: next.guardians,
      guardian_threshold: next.threshold,
      contacts: next.contacts,
      ...(next.lawyer ? { lawyer: next.lawyer } : { lawyer: undefined }),
    };
    const check = checkPolicy(JSON.parse(JSON.stringify(draft)));
    if (!check.ok) throw new Error(check.errors.join(" "));
    policy = check.policy;
    config.policy_hash = policyHash(policy);
  }
  await call(w.owner, "update_will", { config }, nearToYocto("0.05"));
  if (policy) {
    savePolicy(w.owner, policy);
    await agent.submitPolicy(w.owner, policy).catch(() => {});
  }
  await agent.registerOwner(await signRequest(w.owner, "register_owner", {})).catch(() => {});
}
