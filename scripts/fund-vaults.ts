// Funds a demo will's Sepolia and BTC testnet4 vaults from the demo heir's recycled test coins
// (keys in ~/.config/inheirit/demo-accounts.json, see demo-keys.ts). Execution pays the vaults back
// to those same heir addresses, so demo coins circulate instead of being lost. Testnet only.
//
// Usage: npx tsx scripts/fund-vaults.ts <owner> [--eth 0.003] [--sats 30000]
import { chainAdapters, contracts } from "chainsig.js";
import { createPublicClient, http, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { MPC_CONTRACT_ID, vaultPath } from "../src/chains/vault-path";
import { DemoFaucet } from "../src/demo/faucet";
import { loadKeys } from "./demo-keys";

const args = process.argv.slice(2);
const owner = args[0];
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!owner || owner.startsWith("--")) throw new Error("usage: npx tsx scripts/fund-vaults.ts <owner> [--eth 0.003] [--sats 30000]");
const contractId = process.env.AGENT_CONTRACT_ID ?? "inheirit.testnet";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const BTC_API = process.env.BTC_API_URL || "https://mempool.space/testnet4/api";
const eth = opt("eth", "0.003");
const sats = Number(opt("sats", "30000"));

const keys = loadKeys();
if (!keys["heir-eth"] || !keys["heir-btc"]) throw new Error("No demo heir keys; run scripts/demo-keys.ts first");

const mpc = new contracts.ChainSignatureContract({ networkId: "testnet", contractId: MPC_CONTRACT_ID });
const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
const evm = new chainAdapters.evm.EVM({ publicClient: publicClient as never, contract: mpc });
const btc = new chainAdapters.btc.Bitcoin({ network: "testnet", contract: mpc, btcRpcAdapter: new chainAdapters.btc.BTCRpcAdapters.Mempool(BTC_API) });
const vaultEth = (await evm.deriveAddressAndPublicKey(contractId, vaultPath(owner, "Eth"))).address as `0x${string}`;
const vaultBtc = (await btc.deriveAddressAndPublicKey(contractId, vaultPath(owner, "Btc"))).address;
console.log(`contract ${contractId}, owner ${owner}\n  ETH vault ${vaultEth}\n  BTC vault ${vaultBtc}`);

// Same send code as the agent's demo faucet, with the demo heir's keys as the pool
const pool = new DemoFaucet({
  ethPrivateKey: keys["heir-eth"] as `0x${string}`,
  btcPrivateKeyHex: keys["heir-btc"],
  sepoliaRpc: SEPOLIA_RPC,
  btcApi: BTC_API,
  ethWei: parseEther(eth),
  btcSats: sats,
});
if (Number(eth) > 0) {
  const r = await pool.send("Eth", vaultEth);
  console.log(`sent ${eth} ETH: https://sepolia.etherscan.io/tx/${r.txHash}`);
}
if (sats > 0) {
  const r = await pool.send("Btc", vaultBtc);
  console.log(`sent ${sats} sats: https://mempool.space/testnet4/tx/${r.txHash}`);
}
