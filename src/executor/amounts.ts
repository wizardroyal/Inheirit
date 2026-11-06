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

/**
 * Splits `amount` by integer weights (any total). Used when some heirs of a stage were already
 * paid and the rest share what is left in proportion to their original shares.
 */
export function splitWeighted(amount: bigint, weights: Record<string, number>): Map<string, bigint> {
  const paid = Object.entries(weights).filter(([, w]) => w > 0);
  const total = BigInt(paid.reduce((s, [, w]) => s + w, 0));
  const out = new Map<string, bigint>();
  if (total === 0n) return out;
  let left = amount;
  paid.forEach(([id, w], i) => {
    const part = i === paid.length - 1 ? left : (amount * BigInt(w)) / total;
    left -= part;
    out.set(id, part);
  });
  return out;
}

/**
 * What each still-unpaid heir receives in a stage, given the total fees the transfers will cost.
 * Non-last stage: each heir's percent of `gross`; fees are paid from what stays in the vault and
 * rounding dust waits for the last stage. Last stage: everything left after fees, split by the
 * unpaid heirs' shares.
 */
export function stageTargets(
  job: { isLast: boolean; gross: bigint; unpaidShares: Record<string, number> },
  fees: bigint,
): Map<string, bigint> {
  if (job.isLast) {
    const pool = job.gross - fees;
    if (pool <= 0n) throw new Error(`vault balance ${job.gross} does not cover fees ${fees}`);
    return splitWeighted(pool, job.unpaidShares);
  }
  const out = new Map<string, bigint>();
  for (const [id, pct] of Object.entries(job.unpaidShares)) {
    if (pct > 0) out.set(id, (job.gross * BigInt(pct)) / 100n);
  }
  return out;
}

/**
 * Stage targets for a chain that can't send outputs below `dust` (Bitcoin). Without this a small
 * vault split among several heirs makes every attempt throw, the stage never completes, and the will
 * never reaches the secrets (break-it 2026-11-06).
 * - Non-last stage: a slice below dust is deferred; it stays in the vault for the final sweep.
 * - Last stage: the sweep pays the heirs whose share clears dust; dust-sized shares go to them rather
 *   than to miners. A vault holding only dust pays nobody, so the stage still completes.
 */
export function dustSafeTargets(
  job: { isLast: boolean; gross: bigint; unpaidShares: Record<string, number> },
  feeFor: (outputs: number) => bigint,
  dust: bigint,
): Map<string, bigint> {
  if (!job.isLast) {
    const t = stageTargets(job, 0n);
    for (const [id, v] of t) if (v < dust) t.delete(id);
    return t;
  }
  const shares = Object.fromEntries(Object.entries(job.unpaidShares).filter(([, w]) => w > 0));
  for (;;) {
    const ids = Object.keys(shares);
    if (!ids.length) return new Map();
    const pool = job.gross - feeFor(ids.length);
    if (pool < dust) {
      if (job.gross < dust * 2n) return new Map(); // only dust left
      throw new Error(`vault balance ${job.gross} does not cover fees ${feeFor(ids.length)}`);
    }
    const t = splitWeighted(pool, shares);
    const small = [...t].filter(([, v]) => v < dust).map(([id]) => id);
    if (!small.length) return t;
    for (const id of small) delete shares[id];
  }
}
