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

// Release schedules and timings (CLAUDE.md §5.5) are shared with the agent: @agent/policy/schedule.
export { DEMO_SCHEDULE, REAL_SCHEDULE } from "@agent/policy/schedule";

/** Public links judges should be one click from. The X post URL is set once the post exists. */
export const REPO_URL = "https://github.com/wizardroyal/Inheirit";
export const X_POST_URL = process.env.NEXT_PUBLIC_X_POST_URL || "";
