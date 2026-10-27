import { contracts, chainAdapters } from "chainsig.js";
import { createPublicClient, http } from "viem";

// sepolia.drpc.org no longer serves Sepolia on its free plan
export const ethRpcUrl =
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
export const ethContractAddress = "0xb8d9b079F1604e9016137511464A1Fe97F8e2Bd8";

export const ethContractAbi = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_price",
        type: "uint256",
      },
    ],
    name: "updatePrice",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getPrice",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Set up a chain signature contract instance
const MPC_CONTRACT = new contracts.ChainSignatureContract({
  networkId: `testnet`,
  contractId: `v1.signer-prod.testnet`,
});

// Set up a public client for the EVM
const publicClient = createPublicClient({
  transport: http(ethRpcUrl),
});

// Set up a chain signatures chain adapter for the EVM
export const Evm = new chainAdapters.evm.EVM({
  publicClient,
  contract: MPC_CONTRACT,
}) as any;
