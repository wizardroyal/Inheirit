// Prints a will's MPC-derived vault addresses (Sepolia + BTC testnet4) so they can be funded.
// Derivation needs only the contract account and the owner; no keys.
// Usage: npx tsx scripts/vault-addresses.ts <owner> [contract]
import { chainAdapters, contracts } from "chainsig.js";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { MPC_CONTRACT_ID, vaultPath } from "../src/chains/vault-path";

const owner = process.argv[2];
const contractId = process.argv[3] ?? process.env.AGENT_CONTRACT_ID ?? "inheirit.testnet";
if (!owner) throw new Error("usage: npx tsx scripts/vault-addresses.ts <owner> [contract]");

const mpc = new contracts.ChainSignatureContract({ networkId: "testnet", contractId: MPC_CONTRACT_ID });
const evm = new chainAdapters.evm.EVM({
  publicClient: createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") }) as never,
  contract: mpc,
});
const btc = new chainAdapters.btc.Bitcoin({
  network: "testnet",
  contract: mpc,
  btcRpcAdapter: new chainAdapters.btc.BTCRpcAdapters.Mempool("https://mempool.space/testnet4/api"),
});

const eth = await evm.deriveAddressAndPublicKey(contractId, vaultPath(owner, "Eth"));
const b = await btc.deriveAddressAndPublicKey(contractId, vaultPath(owner, "Btc"));
console.log(JSON.stringify({ contractId, owner, eth: eth.address, btc: b.address }, null, 2));
