// Stage amounts for foreign-chain vaults (CLAUDE.md §6). All math in bigint smallest units.
// Each stage releases stage_pct × the balance snapshotted when execution started; the last stage
// releases whatever is left after fees, so nothing is stranded by rounding or gas estimates.

/** Gross amount for `stage` before fees. `remaining` is the vault balance right now. */
export function stageAmount(snapshot: bigint, stagesPct: number[], stage: number, remaining: bigint): bigint {
  if (stage < 0 || stage >= stagesPct.length) throw new Error(`no stage ${stage}`);
  if (stage === stagesPct.length - 1) return remaining;
  const amount = (snapshot * BigInt(stagesPct[stage])) / 100n;
  return amount < remaining ? amount : remaining;
}

/**
 * Splits `amount` across heirs by percent shares (summing to 100). Heirs with 0 get nothing;
 * rounding dust goes to the last paid heir. Order follows the `shares` object's key order.
 */
export function splitByShares(amount: bigint, shares: Record<string, number>): Map<string, bigint> {
  const paid = Object.entries(shares).filter(([, pct]) => pct > 0);
  const total = paid.reduce((s, [, pct]) => s + pct, 0);
  if (paid.length && total !== 100) throw new Error(`shares sum to ${total}, not 100`);
  const out = new Map<string, bigint>();
  let left = amount;
  paid.forEach(([id, pct], i) => {
    const part = i === paid.length - 1 ? left : (amount * BigInt(pct)) / 100n;
    left -= part;
    out.set(id, part);
  });
  return out;
}
