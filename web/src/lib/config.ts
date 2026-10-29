export const AGENT_URL = (process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3000").replace(/\/$/, "");
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "inheirit-dev.testnet";
// rpc.testnet.near.org is deprecated and rate-limits
export const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC || "https://test.rpc.fastnear.com";

export const explorer = {
  nearTx: (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`,
  nearAccount: (id: string) => `https://testnet.nearblocks.io/address/${id}`,
  ethTx: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
  ethAddress: (a: string) => `https://sepolia.etherscan.io/address/${a}`,
  btcTx: (hash: string) => `https://mempool.space/testnet4/tx/${hash}`,
  btcAddress: (a: string) => `https://mempool.space/testnet4/address/${a}`,
};

/** CLAUDE.md §5.1 demo timings (seconds). */
export const DEMO_TIMINGS = { quiet_after: 120, nudge_period: 60, welfare_period: 60, vote_period: 300, challenge_period: 120, stage_interval: 60 };
const DAY = 86_400;
/** Real-life defaults (quiet_after is fixed here; the adaptive baseline is backlog). */
export const REAL_TIMINGS = { quiet_after: 30 * DAY, nudge_period: 7 * DAY, welfare_period: 7 * DAY, vote_period: 30 * DAY, challenge_period: 30 * DAY, stage_interval: 30 * DAY };
