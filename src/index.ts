// Load .env before any other module reads process.env (no-op in the TEE, where there is no .env file)
import "dotenv/config";
import { serve } from "@hono/node-server";
import { ShadeClient } from "@neardefi/shade-agent-js";
import { AttestationGate, liveDeps } from "./ai/attestation";
import { NearAiClient } from "./ai/nearai";
import { draftPolicy } from "./ai/policy-parser";
import { api } from "./api";
import { BtcVault } from "./chains/btc";
import { EvmVault } from "./chains/evm";
import { config, env } from "./config";
import { Driver } from "./escalation/driver";
import { StagedExecutor } from "./executor/executor";
import { ShadeWillContract } from "./near/will-contract";
import { toHex } from "./sealed/crypto";
import { loadSealedKey } from "./sealed/key-source";
import { ensureAgentKey, NoteReleaser } from "./sealed/releaser";
import { EvmNonceAdapter, GithubAdapter, NearOnchainAdapter, SIMULATED_SOURCES, SimulatedAdapter } from "./signals/adapters";
import { Store } from "./state/store";

const agentContractId = config.contractId();
const sponsorAccountId = env("SPONSOR_ACCOUNT_ID");
const sponsorPrivateKey = env("SPONSOR_PRIVATE_KEY");

// Initialize Shade Agent client
const agent = await ShadeClient.create({
  networkId: "testnet",
  agentContractId: agentContractId, // Agent contract the agent will interact with
  sponsor: {
    // Sponsor account details that will fund the agent
    accountId: sponsorAccountId,
    privateKey: sponsorPrivateKey,
  },
  // Derivation path for fixed agent account ID for local
  derivationPath: sponsorPrivateKey, // Random string kept secret (private key does a good job)
  // shade-agent-js 2.2.0 throws "First key and additional keys disagree on derivation method"
  // in local mode with numKeys: 1 ([].every() is true), so use 2
  numKeys: 2,
});

console.log("Agent account ID:", agent.accountId());

// If the agent has low balance, fund it. register_agent attaches 300 Tgas (~0.31 NEAR up front),
// so 0.3 is not enough
const balance = await agent.balance();
if (balance < 0.5) {
  await agent.fund(0.5);
}

// Each failed register_agent burns ~0.02 NEAR, so back off instead of retrying every 10 s
const REGISTER_RETRY_MIN_MS = 10_000;
const REGISTER_RETRY_MAX_MS = 5 * 60_000;
let registerRetryMs = REGISTER_RETRY_MIN_MS;
while (true) {
  try {
    // Register the agent if whitelisted or if the agent contract requires TEE
    const isWhitelisted = await agent.isWhitelisted();
    if (isWhitelisted === null || isWhitelisted) {
      const registered = await agent.register();
      if (registered) {
        console.log("Agent registered");
        break;
      }
    }
  } catch (error) {
    console.error("Register failed:", error instanceof Error ? error.message : error);
  }
  console.log(
    `Not registered (whitelist the agent locally, or approve its measurements); retrying in ${registerRetryMs / 1000}s`,
  );
  await new Promise((resolve) => setTimeout(resolve, registerRetryMs));
  registerRetryMs = Math.min(registerRetryMs * 2, REGISTER_RETRY_MAX_MS);
}

// Re-register every 6 days
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const registered = await agent.register();
    if (registered) {
      console.log("Agent re-registered");
    }
  } catch (error) {
    console.error("Error re-registering agent:", error);
  }
}, SIX_DAYS_MS);

// The will agent
const store = Store.inDir(config.dataDir());
const contract = new ShadeWillContract(agent);
const vaults = [
  new EvmVault(agentContractId, contract, store, config.sepoliaRpc()),
  new BtcVault(agentContractId, contract, store, config.btcApi()),
];
const adapters = [
  new NearOnchainAdapter(config.fastnearTxApi()),
  new EvmNonceAdapter(config.sepoliaRpc(), store),
  new GithubAdapter(config.githubToken()),
  ...SIMULATED_SOURCES.map((s) => new SimulatedAdapter(s.source, s.trustWeight, store)),
];

// Sealed-notes key (§7.5): derived in the TEE, never written to disk or returned by any route.
// On a mismatch with the contract's key, sealed-note work stays disabled; money movement continues.
const sealed = await loadSealedKey(config.dataDir());
let notesEnabled = false;
try {
  notesEnabled = await ensureAgentKey(contract, sealed.keypair, sealed.appId);
} catch (e) {
  console.error("[notes] could not check the agent key; sealed-note work disabled:", e instanceof Error ? e.message : e);
}
const notes = new NoteReleaser(contract, notesEnabled ? sealed.keypair : null);

const driver = new Driver({ contract, adapters, store, notes, executor: new StagedExecutor(contract, vaults, store) });

// NEAR AI Cloud: will contents go only to a model whose TEE attestation passes (checked before each use, cached 10 min)
const nearaiKey = config.nearaiApiKey();
const ai = nearaiKey
  ? (() => {
      const client = new NearAiClient(config.nearaiBaseUrl(), nearaiKey, config.nearaiModel());
      const gate = new AttestationGate(client.model, liveDeps(client.baseUrl, nearaiKey));
      return { attestation: () => gate.current(), draftPolicy: (owner: string, text: string) => draftPolicy(owner, text, client, gate) };
    })()
  : undefined;
if (!ai) console.warn("[ai] NEARAI_API_KEY not set: policy drafting and the AI attestation badge are off");

const app = api({
  ai,
  contract,
  store,
  vaults,
  demoMode: config.demoMode(),
  agentInfo: async () => ({
    accountId: agent.accountId(),
    balance: await agent.balance(),
    agentContractId,
    sealedNotes: { x25519_pubkey: toHex(sealed.keypair.publicKey), app_id: sealed.appId, tee: sealed.tee, enabled: notesEnabled },
  }),
});

// Ticks never overlap: the next one is scheduled after the previous one finishes.
const tickMs = config.tickSeconds() * 1000;
const loop = async () => {
  try {
    await driver.tick();
  } catch (e) {
    console.error("[driver] tick failed:", e);
  }
  setTimeout(loop, tickMs);
};
loop();

// Start server after registration is complete
const port = Number(process.env.PORT || "3000");
console.log(`Server starting on port ${port}...`);
// Keep the native Request/Response globals: dcap-qvl's WASM fetch checks `instanceof Response`, and
// node-server's lightweight replacements make Intel collateral fetches fail ("Failed to get collateral").
serve({ fetch: app.fetch, port, overrideGlobalObjects: false });
