// Load .env before any other module reads process.env (no-op in the TEE, where there is no .env file)
import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { ShadeClient } from "@neardefi/shade-agent-js";
import agentInfo from "./routes/agentInfo";
import ethInfo from "./routes/ethAccountInfo";
import transaction from "./routes/transaction";

const agentContractId = process.env.AGENT_CONTRACT_ID;
const sponsorAccountId = process.env.SPONSOR_ACCOUNT_ID;
const sponsorPrivateKey = process.env.SPONSOR_PRIVATE_KEY;
if (!agentContractId || !sponsorAccountId || !sponsorPrivateKey) {
  throw new Error(
    "Missing required environment variables AGENT_CONTRACT_ID, SPONSOR_ACCOUNT_ID, SPONSOR_PRIVATE_KEY",
  );
}

// Initialize app
const app = new Hono();

// Middleware
app.use(cors());

// Routes
app.get("/", (c) => c.json({ message: "App is running" }));
app.route("/api/agent-info", agentInfo);
app.route("/api/eth-info", ethInfo);
app.route("/api/transaction", transaction);

// Initialize Shade Agent client
export const agent = await ShadeClient.create({
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

// Start server after registration is complete
const port = Number(process.env.PORT || "3000");
console.log(`Server starting on port ${port}...`);
serve({ fetch: app.fetch, port });
