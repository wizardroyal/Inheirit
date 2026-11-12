// Load .env before any other module reads process.env (no-op in the TEE, where there is no .env file)
import { mailerFromEnv } from "./notify/email";
import { fetchBaseline } from "./liveness/baseline";
import { HttpOneClickClient, SimulatedOneClickClient } from "./intents/oneclick";
import { PayoutEngine, simulatedSender } from "./intents/payout";
import "dotenv/config";
import { serve } from "@hono/node-server";
import { ShadeClient } from "@neardefi/shade-agent-js";
import { AttestationGate, liveDeps } from "./ai/attestation";
import { NearAiClient } from "./ai/nearai";
import { heirGuide, type GuideTurn } from "./ai/heir-guide";
import { draftPolicy } from "./ai/policy-parser";
import { api } from "./api";
import { Nep413Verifier, rpcAccessKey } from "./auth/nep413";
import { BtcVault } from "./chains/btc";
import { EvmVault } from "./chains/evm";
import { config, env } from "./config";
import { nearRpcProvider } from "./near-rpc";
import { DemoFaucet } from "./demo/faucet";
import { Driver } from "./escalation/driver";
import { StagedExecutor } from "./executor/executor";
import { ShadeWillContract, type WillView } from "./near/will-contract";
import { toHex } from "./sealed/crypto";
import { loadSealedKey } from "./sealed/key-source";
import { ensureAgentKey, NoteReleaser } from "./sealed/releaser";
import {
  EvmNonceAdapter,
  GithubAdapter,
  HeartbeatAdapter,
  NearOnchainAdapter,
  SIMULATED_SOURCES,
  SimulatedAdapter,
  TelegramAdapter,
} from "./signals/adapters";
import { HttpTelegramApi, TelegramBot } from "./telegram/bot";
import type { Policy } from "./policy/policy";
import { Store } from "./state/store";
import { parseEther } from "viem";

const agentContractId = config.contractId();
const sponsorAccountId = env("SPONSOR_ACCOUNT_ID");
const sponsorPrivateKey = env("SPONSOR_PRIVATE_KEY");

// NEAR RPC: one URL or a comma-separated list with failover. The agent's calls all come from one IP,
// and FastNEAR's free tier throttles it (429), so a keyed or second endpoint can be configured.
const rpcEndpoints = config.nearRpcEndpoints();
const rpc = nearRpcProvider(rpcEndpoints);

// Initialize Shade Agent client
const agent = await ShadeClient.create({
  networkId: "testnet",
  rpc,
  agentContractId: agentContractId, // Agent contract the agent will interact with
  sponsor: {
    // Sponsor account details that will fund the agent
    accountId: sponsorAccountId,
    privateKey: sponsorPrivateKey,
  },
  // Derivation path for fixed agent account ID for local
  derivationPath: sponsorPrivateKey, // Random string kept secret (private key does a good job)
  // shade-agent-js signs each call with the next key round-robin, so concurrent agent transactions need
  // as many keys as can be in flight: driver concurrency (4) + execution queue (2), plus margin. (It also
  // throws "First key and additional keys disagree on derivation method" in local mode with numKeys: 1.)
  numKeys: 8,
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
// Failed attempts (e.g. before measurements are approved) drain the boot funding below what
// register_agent needs, so top up again, but only a few times so a stuck agent can't drain the sponsor
const REGISTER_MIN_BALANCE = 0.35;
let topUpsLeft = 3;
while (true) {
  try {
    if (topUpsLeft > 0 && (await agent.balance()) < REGISTER_MIN_BALANCE) {
      topUpsLeft--;
      console.log(`Agent balance below ${REGISTER_MIN_BALANCE} NEAR; topping up 0.5 (${topUpsLeft} top-ups left)`);
      await agent.fund(0.5);
    }
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

// Gas watchdog: the agent pays for every advance, record and signature. If its balance runs low (heavy
// use, or someone trying to drain it), top it up from the sponsor, at most a few times a day so a drain
// can't empty the sponsor either (audit round 2).
const GAS_FLOOR = 0.25;
const GAS_TOP_UPS_PER_DAY = 4;
let gasTopUps: number[] = [];
setInterval(async () => {
  try {
    if ((await agent.balance()) >= GAS_FLOOR) return;
    const dayAgo = Date.now() - 24 * 3_600_000;
    gasTopUps = gasTopUps.filter((t) => t > dayAgo);
    if (gasTopUps.length >= GAS_TOP_UPS_PER_DAY) {
      console.error(`Agent balance below ${GAS_FLOOR} NEAR and today's ${GAS_TOP_UPS_PER_DAY} top-ups are used`);
      return;
    }
    gasTopUps.push(Date.now());
    console.log(`Agent balance below ${GAS_FLOOR} NEAR; topping up 0.5 from the sponsor`);
    await agent.fund(0.5);
  } catch (error) {
    console.error("Gas watchdog:", error instanceof Error ? error.message : error);
  }
}, 5 * 60_000);

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
  new HeartbeatAdapter(store),
  new TelegramAdapter(store),
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

// Telegram check bot (§7.7): long polling, so it needs no inbound URL.
const tgToken = config.telegramToken();
const tgUsername = config.telegramUsername();
// Set once the driver exists; a reply that arrives before then just waits for the next tick.
let pokeOwner: (owner: string) => void = () => {};
const telegram =
  tgToken && tgUsername
    ? new TelegramBot(new HttpTelegramApi(tgToken), store, tgUsername, { onReply: (accounts) => accounts.forEach((a) => pokeOwner(a)) })
    : undefined;
if (telegram) {
  console.log(`[telegram] check bot on: @${tgUsername}`);
  void telegram.run();
} else {
  console.log("[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME not set; Telegram checks off");
}

// NEAR Intents (§J): NEAR Intents has no testnet, so the agent's onward payouts and fund-from-anywhere
// quotes use the SIMULATED 1Click client, priced from the live public /v0/tokens list. Real mainnet
// payouts only run from the local, approval-gated scripts/mainnet-payout.ts.
const intents = new SimulatedOneClickClient(new HttpOneClickClient(undefined, config.oneclickBaseUrl()));
const payouts = new PayoutEngine({
  store,
  client: intents,
  sender: simulatedSender,
  refundTo: async (owner, chain) => (chain === "Near" ? agentContractId : vaults.find((v) => v.chain === chain)!.address(owner)),
});

// Real email when RESEND_API_KEY and NOTIFY_FROM_EMAIL are set; otherwise checks show in the app only.
const mailer = mailerFromEnv();
console.log(mailer ? "Email: on (Resend)" : "Email: off (RESEND_API_KEY / NOTIFY_FROM_EMAIL not set); email checks show in the app only");
const driver = new Driver({
  payouts,
  contract,
  adapters,
  store,
  notes,
  telegram,
  mailer,
  executor: new StagedExecutor(contract, vaults, store),
  demoWatchMs: config.demoMode() ? config.demoWatchHours() * 3_600_000 : undefined,
});
pokeOwner = (owner) => void driver.poke(owner);

// NEAR AI Cloud: will contents go only to a model whose TEE attestation passes (checked before each use, cached 10 min)
const nearaiKey = config.nearaiApiKey();
const ai = nearaiKey
  ? (() => {
      const client = new NearAiClient(config.nearaiBaseUrl(), nearaiKey, config.nearaiModel());
      const gate = new AttestationGate(client.model, liveDeps(client.baseUrl, nearaiKey));
      // Startup check (§7.6): log whether the configured model attests. Will contents stay gated by
      // gate.require() before every request either way; this only surfaces a bad model at boot.
      void gate.current().then(
        (r) => console.log(`[ai] ${client.model} attestation at startup: ${r.ok ? "passed" : `FAILED (${r.error}); will contents will be refused`}`),
        (e) => console.error(`[ai] ${client.model} attestation at startup could not run: ${e instanceof Error ? e.message : e}`),
      );
      return {
        attestation: () => gate.current(),
        draftPolicy: (owner: string, text: string) => draftPolicy(owner, text, client, gate),
        heirGuide: (...a: [WillView, string, Policy | undefined, string, GuideTurn[]]) => heirGuide(...a, client, gate),
      };
    })()
  : undefined;
if (!ai) console.warn("[ai] NEARAI_API_KEY not set: policy drafting and the AI attestation badge are off");

// Demo vault faucet: only in demo mode, only when both pool keys are configured
const faucetEthKey = config.faucetEthKey();
const faucetBtcKey = config.faucetBtcKey();
const faucet =
  config.demoMode() && faucetEthKey && faucetBtcKey
    ? (() => {
        const ethWei = parseEther(config.faucetEth());
        const btcSats = config.faucetSats();
        const f = new DemoFaucet({
          ethPrivateKey: faucetEthKey as `0x${string}`,
          btcPrivateKeyHex: faucetBtcKey,
          sepoliaRpc: config.sepoliaRpc(),
          btcApi: config.btcApi(),
          ethWei,
          btcSats,
        });
        console.log(`[faucet] demo vault faucet on: ETH ${f.ethAddress}, BTC ${f.btcAddress}`);
        return {
          ethAddress: f.ethAddress,
          btcAddress: f.btcAddress,
          amounts: { eth_wei: ethWei.toString(), btc_sats: btcSats },
          send: (chain: "Eth" | "Btc", to: string) => f.send(chain, to),
        };
      })()
    : undefined;

const app = api({
  onSignOfLife: (owner) => pokeOwner(owner),
  // A separate client: unsigned fund-from-anywhere quotes never share memory with the engine's deposits.
  intents: new SimulatedOneClickClient(new HttpOneClickClient(undefined, config.oneclickBaseUrl())),
  faucet,
  telegram,
  ai,
  auth: new Nep413Verifier({ recipient: agentContractId, accessKey: rpcAccessKey(rpcEndpoints[0]) }),
  contract,
  store,
  vaults,
  demoMode: config.demoMode(),
  baseline: (near, sepolia) => fetchBaseline(near, sepolia),
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
