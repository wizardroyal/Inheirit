// Funds a demo will's Sepolia and BTC testnet4 vaults from the demo heir's recycled test coins
// (keys in ~/.config/inheirit/demo-accounts.json, see demo-keys.ts). Execution pays the vaults back
// to those same heir addresses, so demo coins circulate instead of being lost. Testnet only.
//
// Usage: npx tsx scripts/fund-vaults.ts <owner> [--eth 0.003] [--sats 30000]
import { secp256k1 } from "@noble/curves/secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { chainAdapters, contracts } from "chainsig.js";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { MPC_CONTRACT_ID, vaultPath } from "../src/chains/vault-path";
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

// Sepolia: a plain value transfer from the heir's key
if (Number(eth) > 0) {
  const account = privateKeyToAccount(keys["heir-eth"] as `0x${string}`);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) });
  const hash = await wallet.sendTransaction({ to: vaultEth, value: parseEther(eth) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`sent ${eth} ETH: https://sepolia.etherscan.io/tx/${hash} (status ${receipt.status})`);
}

// BTC testnet4: P2WPKH from the heir's key, change back to the heir
if (sats > 0) {
  const priv = Buffer.from(keys["heir-btc"], "hex");
  const pubkey = Buffer.from(secp256k1.getPublicKey(priv, true));
  const network = bitcoin.networks.testnet;
  const pay = bitcoin.payments.p2wpkh({ pubkey, network });
  const from = pay.address!;
  const utxoRes = await fetch(`${BTC_API}/address/${from}/utxo`);
  if (!utxoRes.ok) throw new Error(`UTXO fetch ${utxoRes.status}`);
  const utxos = ((await utxoRes.json()) as { txid: string; vout: number; value: number }[]).sort((a, b) => b.value - a.value);
  const feeRes = await fetch(`${BTC_API}/v1/fees/recommended`);
  const rate = Math.max(1, Math.ceil(((await feeRes.json()) as { halfHourFee: number }).halfHourFee));
  const psbt = new bitcoin.Psbt({ network });
  let total = 0;
  for (const u of utxos) {
    psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: pay.output!, value: u.value } });
    total += u.value;
    if (total >= sats + 1000) break;
  }
  const fee = Math.ceil((11 + 68 * psbt.inputCount + 31 * 2) * rate);
  const change = total - sats - fee;
  if (change < 0) throw new Error(`heir has ${total} sats, needs ${sats + fee}`);
  psbt.addOutput({ address: vaultBtc, value: sats });
  if (change >= 546) psbt.addOutput({ address: from, value: change });
  const signer = {
    publicKey: pubkey,
    sign: (hash: Buffer) => Buffer.from(secp256k1.sign(hash, priv, { lowS: true }).toCompactRawBytes()),
  };
  psbt.signAllInputs(signer);
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  const res = await fetch(`${BTC_API}/tx`, { method: "POST", body: tx.toHex() });
  if (!res.ok) throw new Error(`BTC broadcast ${res.status}: ${await res.text()}`);
  console.log(`sent ${sats} sats (fee ${fee}): https://mempool.space/testnet4/tx/${tx.getId()}`);
}
