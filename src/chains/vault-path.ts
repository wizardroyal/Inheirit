// Must match agent-contract/src/will/mod.rs vault_path(): the contract builds this path itself
// when it forwards a signature request, so the derived addresses below are the will's vaults.
export function vaultPath(owner: string, chain: "Eth" | "Btc"): string {
  return `heirloom/${owner}/${chain === "Eth" ? "eth" : "btc"}`;
}

export const MPC_CONTRACT_ID = "v1.signer-prod.testnet";
