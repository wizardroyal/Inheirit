// Environment, read lazily (modules that read env at import time miss values loaded later).
export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${name}`);
}

export const config = {
  contractId: () => env("AGENT_CONTRACT_ID"),
  /** One URL or a comma-separated list (tried in order on failure). */
  nearRpc: () => env("NEAR_RPC_URL", "https://test.rpc.fastnear.com"),
  nearRpcEndpoints: () => rpcEndpoints(env("NEAR_RPC_URL", "https://test.rpc.fastnear.com")),
  fastnearTxApi: () => env("FASTNEAR_TX_API", "https://tx.test.fastnear.com"),
  sepoliaRpc: () => env("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
  btcApi: () => env("BTC_API_URL", "https://mempool.space/testnet4/api"),
  githubToken: () => process.env.GITHUB_TOKEN || undefined,
  dataDir: () => env("DATA_DIR", "./data"),
  tickSeconds: () => Number(env("TICK_SECONDS", "15")),
  demoMode: () => env("DEMO_MODE", "false") === "true",
  /** Demo mode: hours a will is driven after the agent starts watching it (re-register to resume). */
  demoWatchHours: () => Number(env("DEMO_WATCH_HOURS", "3")),
  nearaiBaseUrl: () => env("NEARAI_BASE_URL", "https://cloud-api.near.ai/v1"),
  nearaiApiKey: () => process.env.NEARAI_API_KEY || undefined,
  // Attested (TEE) model; see Decision log 2026-10-27. Proxied models fail the attestation gate.
  nearaiModel: () => env("NEARAI_MODEL", "z-ai/glm-5.3-flash"),
  // Demo vault faucet pool (testnet keys; demo mode only). Both keys must be set to enable it.
  faucetEthKey: () => process.env.DEMO_FAUCET_ETH_KEY || undefined,
  faucetBtcKey: () => process.env.DEMO_FAUCET_BTC_KEY || undefined,
  faucetEth: () => env("DEMO_FAUCET_ETH", "0.002"),
  faucetSats: () => Number(env("DEMO_FAUCET_SATS", "20000")),
  // Telegram check bot (CLAUDE.md §7.7); off unless both are set.
  telegramToken: () => process.env.TELEGRAM_BOT_TOKEN || undefined,
  telegramUsername: () => (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "") || undefined,
  // NEAR Intents 1Click (§J). The agent only reads its public token list; it never moves mainnet funds.
  oneclickBaseUrl: () => process.env.ONECLICK_BASE_URL || "https://1click.chaindefuser.com",
};

export interface RpcEndpoint {
  url: string;
  headers?: Record<string, string>;
}

/**
 * Parse NEAR_RPC_URL. An `apiKey` query parameter (FastNEAR's form) is moved into an
 * `Authorization: Bearer` header: near-js puts the URL in some error messages, and the TEE's logs are public.
 */
export function rpcEndpoints(list: string): RpcEndpoint[] {
  return list
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((raw) => {
      const u = new URL(raw);
      const key = u.searchParams.get("apiKey");
      if (!key) return { url: raw };
      u.searchParams.delete("apiKey");
      return { url: u.toString(), headers: { Authorization: `Bearer ${key}` } };
    });
}
