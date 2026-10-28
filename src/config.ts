// Environment, read lazily (modules that read env at import time miss values loaded later).
export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${name}`);
}

export const config = {
  contractId: () => env("AGENT_CONTRACT_ID"),
  nearRpc: () => env("NEAR_RPC_URL", "https://test.rpc.fastnear.com"),
  fastnearTxApi: () => env("FASTNEAR_TX_API", "https://tx.test.fastnear.com"),
  sepoliaRpc: () => env("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
  btcApi: () => env("BTC_API_URL", "https://mempool.space/testnet4/api"),
  githubToken: () => process.env.GITHUB_TOKEN || undefined,
  dataDir: () => env("DATA_DIR", "./data"),
  tickSeconds: () => Number(env("TICK_SECONDS", "15")),
  demoMode: () => env("DEMO_MODE", "false") === "true",
  nearaiBaseUrl: () => env("NEARAI_BASE_URL", "https://cloud-api.near.ai/v1"),
  nearaiApiKey: () => process.env.NEARAI_API_KEY || undefined,
  // Attested (TEE) model; see Decision log 2026-10-27. Proxied models fail the attestation gate.
  nearaiModel: () => env("NEARAI_MODEL", "z-ai/glm-5.3-flash"),
};
