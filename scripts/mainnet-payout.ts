// MAINNET NEAR Intents demo (CLAUDE.md §J.6). NEAR Intents has no testnet, so the Intents legs are
// shown on mainnet with small real amounts from a demo vault the human controls. This script is the
// only code in the repo that can move mainnet value, and it never does so without a typed "yes".
//
// The demo vault is a Chain Signatures address on Base, derived from the human's NEAR mainnet account
// (MAINNET_DEMO_ACCOUNT) and path, signed by v1.signer. Fallback: a plain EVM key (MAINNET_DEMO_EVM_KEY).
//
//   npx tsx scripts/mainnet-payout.ts preflight [--amount 2]     # go/no-go checklist before any real payout (read-only)
//   npx tsx scripts/mainnet-payout.ts vault                      # Base vault address + balances (read-only)
//   npx tsx scripts/mainnet-payout.ts tokens [SYMBOL]            # 1Click tokens (read-only)
//   npx tsx scripts/mainnet-payout.ts quote --to base:USDC --amount 2 --recipient 0x… [--confidential basic]
//                                                                # dry quote from the vault's Base USDC (read-only)
//   npx tsx scripts/mainnet-payout.ts pay --to sol:USDC --amount 2 --recipient <addr> [--link owner:round:stage:heir]
//                                                                # real payout: quote, print, wait for "yes", send
//   npx tsx scripts/mainnet-payout.ts fund --from arb:USDC --amount 3 --refund <your origin address>
//                                                                # fund-from-anywhere: deposit address into the vault;
//                                                                # you send from your own wallet (this script never does)
//   npx tsx scripts/mainnet-payout.ts status <depositAddress>
//
// Caps (§Safety): INTENTS_MAX_USD_PER_TX (default 5) per transaction, INTENTS_MAX_USD_TOTAL (default 25)
// across all runs, tracked in ~/.config/inheirit/mainnet-ledger.json. Records go to
// web/src/data/mainnet-payouts.json so the app can show them next to the testnet stage.
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { Account } from "@near-js/accounts";
import type { KeyPairString } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { chainAdapters, contracts, utils, type MPCSignature } from "chainsig.js";
import { createPublicClient, encodeFunctionData, erc20Abi, formatEther, http, keccak256, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { HttpOneClickClient, type IntentsToken, quoteRequest, type QuoteResponse, TERMINAL } from "../src/intents/oneclick";

const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const MPC = "v1.signer";
// [VERIFY] mainnet sign deposit: v1.signer runs the same code as v1.signer-prod.testnet, which takes 1 yocto.
const SIGN_DEPOSIT = BigInt(process.env.MAINNET_SIGN_DEPOSIT_YOCTO || "1");
function cap(name: string, fallback: number): number {
  const v = Number(process.env[name] || fallback);
  // A typo must never turn the caps off (NaN compares false).
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} must be a positive number`);
  return v;
}
const MAX_TX = cap("INTENTS_MAX_USD_PER_TX", 5);
const MAX_TOTAL = cap("INTENTS_MAX_USD_TOTAL", 25);
const LEDGER = path.join(os.homedir(), ".config/inheirit/mainnet-ledger.json");
const RECORDS = path.join(import.meta.dirname, "../web/src/data/mainnet-payouts.json");

const oneclick = new HttpOneClickClient(process.env.ONECLICK_JWT, process.env.ONECLICK_BASE_URL || undefined);
const baseClient = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") });
const nearProvider = new JsonRpcProvider({ url: process.env.MAINNET_NEAR_RPC_URL || "https://rpc.mainnet.fastnear.com" });
const mpc = new contracts.ChainSignatureContract({ networkId: "mainnet", contractId: MPC });
const evm = new chainAdapters.evm.EVM({ publicClient: baseClient as never, contract: mpc });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function need(name: string): string {
  const v = arg(name);
  if (!v) throw new Error(`--${name} is required`);
  return v;
}

/** "base:USDC" -> the token on that chain. */
async function token(spec: string): Promise<IntentsToken> {
  const [chain, symbol] = spec.split(":");
  const t = (await oneclick.tokens()).find((x) => x.blockchain === chain && x.symbol.toLowerCase() === symbol?.toLowerCase());
  if (!t) throw new Error(`No 1Click token ${spec} (see: tokens ${symbol ?? ""})`);
  return t;
}

/** The demo vault: Chain Signatures-derived (primary) or a plain EVM key (fallback). */
async function vault(): Promise<{ address: Hex; kind: "chain-signatures" | "evm-key" }> {
  const evmKey = process.env.MAINNET_DEMO_EVM_KEY;
  if (evmKey) return { address: privateKeyToAccount(evmKey as Hex).address, kind: "evm-key" };
  const account = process.env.MAINNET_DEMO_ACCOUNT;
  if (!account) throw new Error("Set MAINNET_DEMO_ACCOUNT (NEAR mainnet account whose key you hold) or MAINNET_DEMO_EVM_KEY in .env");
  const p = process.env.MAINNET_DEMO_DERIVATION_PATH || "inheirit/demo/base";
  return { address: (await evm.deriveAddressAndPublicKey(account, p)).address as Hex, kind: "chain-signatures" };
}

async function balances(address: Hex) {
  const [eth, usdc] = await Promise.all([
    baseClient.getBalance({ address }),
    baseClient.readContract({ address: BASE_USDC_CONTRACT, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  return { eth, usdc };
}

type Ledger = { total_usd: number; txs: { at: string; usd: number; status: "reserved" | "sent"; txHash?: string; depositAddress: string }[] };
function ledger(): Ledger {
  return fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { total_usd: 0, txs: [] };
}
function saveLedger(l: Ledger) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
}

// 1Click sometimes returns a tx hash with an empty explorerUrl; build the link from the hash then.
const EXPLORERS: Record<string, string> = {
  sol: "https://solscan.io/tx/",
  arb: "https://arbiscan.io/tx/",
  base: "https://basescan.org/tx/",
  eth: "https://etherscan.io/tx/",
  op: "https://optimistic.etherscan.io/tx/",
  pol: "https://polygonscan.com/tx/",
  near: "https://nearblocks.io/txns/",
  btc: "https://mempool.space/tx/",
};
function explorerTx(chain: string, h?: { hash: string; explorerUrl?: string }): string | null {
  if (!h) return null;
  if (h.explorerUrl) return h.explorerUrl;
  return EXPLORERS[chain] ? EXPLORERS[chain] + h.hash : null;
}

async function confirm(lines: string[]): Promise<boolean> {
  console.log(`\n${"=".repeat(72)}\nMAINNET TRANSACTION. Real funds. Check every line:\n`);
  for (const l of lines) console.log(`  ${l}`);
  console.log(`${"=".repeat(72)}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type "yes" to send, anything else to stop: ')).trim();
  rl.close();
  return answer === "yes";
}

/** Signs a Base tx hash with the demo vault's key: MPC (v1.signer) or the fallback EVM key. */
async function signAndSend(tx: { to: Hex; data: Hex; from: Hex }): Promise<Hex> {
  const fees = await baseClient.estimateFeesPerGas();
  const gas = ((await baseClient.estimateGas({ account: tx.from, to: tx.to, data: tx.data })) * 130n) / 100n;
  const nonce = await baseClient.getTransactionCount({ address: tx.from, blockTag: "pending" });
  const evmKey = process.env.MAINNET_DEMO_EVM_KEY;
  let raw: Hex;
  if (evmKey) {
    const acct = privateKeyToAccount(evmKey as Hex);
    raw = await acct.signTransaction({ chainId: base.id, to: tx.to, data: tx.data, gas, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, type: "eip1559" });
  } else {
    const id = process.env.MAINNET_DEMO_ACCOUNT!;
    const key = process.env.MAINNET_DEMO_PRIVATE_KEY;
    if (!key) throw new Error("MAINNET_DEMO_PRIVATE_KEY is not set");
    const { transaction, hashesToSign } = await evm.prepareTransactionForSigning({
      from: tx.from,
      to: tx.to,
      data: tx.data,
      value: 0n,
      gas,
      nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const near = new Account(id, nearProvider, KeyPairSigner.fromSecretKey(key as KeyPairString));
    console.log("Asking the MPC network (v1.signer) for a signature; this can take up to a minute…");
    const outcome = await near.callFunctionRaw({
      contractId: MPC,
      methodName: "sign",
      args: {
        request: {
          payload_v2: { Ecdsa: utils.cryptography.uint8ArrayToHex(hashesToSign[0]) },
          path: process.env.MAINNET_DEMO_DERIVATION_PATH || "inheirit/demo/base",
          domain_id: 0,
        },
      },
      deposit: SIGN_DEPOSIT,
      gas: 300n * 10n ** 12n,
    });
    const ok = (outcome.status as { SuccessValue?: string }).SuccessValue;
    if (!ok) throw new Error(`MPC sign failed: ${JSON.stringify(outcome.status)}`);
    const sig = JSON.parse(Buffer.from(ok, "base64").toString()) as MPCSignature;
    console.log(`MPC signature: https://nearblocks.io/txns/${outcome.transaction.hash}`);
    raw = evm.finalizeTransactionSigning({ transaction, rsvSignatures: [utils.cryptography.toRSV(sig)] }) as Hex;
  }
  await baseClient.sendRawTransaction({ serializedTransaction: raw });
  return keccak256(raw);
}

async function waitStatus(depositAddress: string) {
  for (let i = 0; i < 90; i++) {
    const st = await oneclick.status(depositAddress);
    console.log(`  ${new Date().toISOString()} ${st.status}`);
    if (TERMINAL.includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error("Still not final after 15 min; check later with: status " + depositAddress);
}

async function quoteFromVault(dry: boolean): Promise<{ q: QuoteResponse; to: IntentsToken; v: Awaited<ReturnType<typeof vault>>; usd: number }> {
  const to = await token(need("to"));
  const usd = Number(need("amount"));
  if (!(usd > 0)) throw new Error("--amount is in USDC, e.g. 2");
  const v = await vault();
  const confidentiality = arg("confidential") as "basic" | "advanced" | undefined;
  const q = await oneclick.quote(
    quoteRequest({
      dry,
      originAsset: BASE_USDC,
      destinationAsset: to.assetId,
      amount: parseUnits(usd.toString(), 6).toString(),
      refundTo: v.address,
      recipient: need("recipient"),
      confidentiality,
    }),
  );
  return { q, to, v, usd };
}

/** Read-only checks before a real payout: each line is OK, or says what to fix. Exits 1 if anything blocks. */
async function preflight() {
  const amount = Number(arg("amount") ?? "2");
  const rows: [boolean, string][] = [];
  const check = async (label: string, fn: () => Promise<string>) => {
    try {
      rows.push([true, `${label}: ${await fn()}`]);
    } catch (e) {
      rows.push([false, `${label}: ${e instanceof Error ? e.message : String(e)}`]);
    }
  };
  await check("1Click key", async () => {
    if (!process.env.ONECLICK_JWT) throw new Error("ONECLICK_JWT is not set in .env (needed for confidential quotes and no partner fee)");
    return "set";
  });
  const v = await vault().catch((e) => {
    rows.push([false, `vault: ${e.message}`]);
    return null;
  });
  if (v) {
    rows.push([true, `vault (${v.kind}): ${v.address}  https://basescan.org/address/${v.address}`]);
    if (v.kind === "chain-signatures") {
      const id = process.env.MAINNET_DEMO_ACCOUNT!;
      await check("NEAR mainnet account", async () => {
        const acct = await nearProvider.viewAccount(id);
        const near = Number(BigInt(acct.amount)) / 1e24;
        if (near < 0.05) throw new Error(`${id} holds ${near.toFixed(4)} NEAR; keep ≥ 0.05 for the MPC sign call`);
        return `${id} holds ${near.toFixed(4)} NEAR`;
      });
      await check("account key", async () => {
        const key = process.env.MAINNET_DEMO_PRIVATE_KEY;
        if (!key) throw new Error("MAINNET_DEMO_PRIVATE_KEY is not set");
        const pk = KeyPairSigner.fromSecretKey(key as KeyPairString);
        const pub = (await pk.getPublicKey()).toString();
        const keys = await nearProvider.viewAccessKeyList(id);
        if (!keys.keys.some((k) => k.public_key === pub)) throw new Error(`MAINNET_DEMO_PRIVATE_KEY is not a key on ${id}`);
        return "matches the account";
      });
    }
    await check("vault balances", async () => {
      const b = await balances(v.address);
      const usdc = Number(b.usdc) / 1e6;
      const eth = Number(formatEther(b.eth));
      if (usdc < amount) throw new Error(`${usdc} USDC on Base; need ≥ ${amount} for one payout (send USDC on Base to the vault, or use the fund command)`);
      if (eth < 0.00005) throw new Error(`${eth} ETH on Base; need a little ETH for gas (≈ $0.50 is plenty)`);
      return `${usdc} USDC, ${eth.toFixed(6)} ETH`;
    });
    for (const conf of [undefined, "basic"] as const) {
      await check(`dry quote ${conf ? "confidential" : "public"} (Base USDC → Arbitrum USDC, $${amount})`, async () => {
        const arb = await token("arb:USDC");
        const q = await oneclick.quote(
          quoteRequest({ dry: true, originAsset: BASE_USDC, destinationAsset: arb.assetId, amount: parseUnits(amount.toString(), 6).toString(), refundTo: v.address, recipient: v.address, confidentiality: conf }),
        );
        return `≈ ${q.quote.amountOutFormatted} USDC, about ${q.quote.timeEstimate} s`;
      });
    }
  }
  const l = ledger();
  rows.push([l.total_usd + amount <= MAX_TOTAL && amount <= MAX_TX, `caps: $${amount} per payout (max ${MAX_TX}); $${l.total_usd} spent so far of $${MAX_TOTAL}`]);
  console.log(`\nMainnet preflight (read-only; nothing is sent)\n`);
  for (const [ok, line] of rows) console.log(`  ${ok ? "OK  " : "FIX "} ${line}`);
  const blocked = rows.some(([ok]) => !ok);
  console.log(blocked ? "\nNot ready: fix the lines marked FIX." : "\nReady. Next: the pay command (see docs/MAINNET.md).");
  if (blocked) process.exitCode = 1;
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "preflight") {
    await preflight();
  } else if (cmd === "tokens") {
    const sym = process.argv[3]?.toLowerCase();
    for (const t of await oneclick.tokens()) if (!sym || t.symbol.toLowerCase() === sym) console.log(`${t.blockchain}:${t.symbol}\t${t.assetId}\t$${t.price}`);
  } else if (cmd === "vault") {
    const v = await vault();
    const b = await balances(v.address);
    console.log({ vault: v.address, kind: v.kind, base_eth: formatEther(b.eth), base_usdc: Number(b.usdc) / 1e6, spent_usd_so_far: ledger().total_usd, caps: { per_tx: MAX_TX, total: MAX_TOTAL } });
  } else if (cmd === "quote") {
    const { q, to } = await quoteFromVault(true);
    console.log(`DRY quote: ${q.quote.amountInFormatted} USDC (Base) → ${q.quote.amountOutFormatted} ${to.symbol} (${to.blockchain}), min ${q.quote.minAmountOut}, ~${q.quote.timeEstimate}s`);
  } else if (cmd === "pay") {
    const usd = Number(need("amount"));
    const spent = ledger().total_usd;
    if (usd > MAX_TX) throw new Error(`$${usd} is over the per-transaction cap ($${MAX_TX}, INTENTS_MAX_USD_PER_TX)`);
    if (spent + usd > MAX_TOTAL) throw new Error(`$${spent} spent so far + $${usd} is over the total cap ($${MAX_TOTAL}, INTENTS_MAX_USD_TOTAL)`);
    const { q, to, v } = await quoteFromVault(false);
    const dep = q.quote.depositAddress as Hex | undefined;
    if (!dep) throw new Error("No deposit address in the quote");
    const b = await balances(v.address);
    const amount = BigInt(q.quote.amountIn);
    // Send exactly what was asked and capped, never a figure from the quote response.
    if (amount !== parseUnits(usd.toString(), 6)) throw new Error(`Quote amountIn ${q.quote.amountIn} differs from the requested ${usd} USDC; not sending`);
    if (b.usdc < amount) throw new Error(`Vault ${v.address} has ${Number(b.usdc) / 1e6} USDC, needs ${usd}`);
    const ok = await confirm([
      `From:        ${usd} USDC on Base (${amount} units), demo vault ${v.address} (${v.kind})`,
      `To:          ${q.quote.amountOutFormatted} ${to.symbol} on ${to.blockchain} (min ${q.quote.minAmountOut} units after 1% slippage)`,
      `Recipient:   ${need("recipient")}`,
      `Value out:   $${q.quote.amountOutUsd} (in $${q.quote.amountInUsd}; fees ≈ $${(Number(q.quote.amountInUsd) - Number(q.quote.amountOutUsd)).toFixed(4)})`,
      `Deposit to:  ${dep} (1Click, deadline ${q.quote.deadline})`,
      `Refunds to:  ${v.address} (the vault)`,
      `Privacy:     ${arg("confidential") ?? "public"}`,
      `Gas:         paid in ETH from the vault (has ${formatEther(b.eth)} ETH)`,
      `Caps:        $${spent} spent so far of $${MAX_TOTAL}; this one $${usd} of $${MAX_TX} max`,
      `Links to:    ${arg("link") ?? "(no testnet stage)"}`,
    ]);
    if (!ok) return console.log("Stopped. Nothing was sent.");
    // Reserve against the cap before signing: if the process dies after broadcasting, the spend still counts.
    const l = ledger();
    l.total_usd += usd;
    const entry: Ledger["txs"][number] = { at: new Date().toISOString(), usd, status: "reserved", depositAddress: dep };
    l.txs.push(entry);
    saveLedger(l);
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [dep, amount] });
    const txHash = await signAndSend({ from: v.address, to: BASE_USDC_CONTRACT, data });
    console.log(`Deposit sent: https://basescan.org/tx/${txHash}`);
    Object.assign(entry, { status: "sent", txHash });
    saveLedger(l);
    await oneclick.submitDeposit(txHash, dep).catch((e) => console.warn(`deposit/submit: ${e.message} (status polling still works)`));
    const st = await waitStatus(dep);
    const records = fs.existsSync(RECORDS) ? JSON.parse(fs.readFileSync(RECORDS, "utf8")) : [];
    records.push({
      at: new Date().toISOString(),
      link: arg("link") ?? null,
      from: { chain: "base", symbol: "USDC", amount: usd, tx: `https://basescan.org/tx/${txHash}` },
      to: { chain: to.blockchain, symbol: to.symbol, amount: st.swapDetails?.amountOutFormatted ?? q.quote.amountOutFormatted, recipient: need("recipient"), tx: explorerTx(to.blockchain, st.swapDetails?.destinationChainTxHashes?.[0]) },
      confidentiality: arg("confidential") ?? "public",
      vault: v.kind,
      status: st.status,
      depositAddress: dep,
    });
    fs.writeFileSync(RECORDS, `${JSON.stringify(records, null, 2)}\n`);
    console.log(`${st.status}. Recorded in ${path.relative(process.cwd(), RECORDS)}`);
  } else if (cmd === "fund") {
    const from = await token(need("from"));
    const v = await vault();
    const q = await oneclick.quote(
      quoteRequest({ dry: false, originAsset: from.assetId, destinationAsset: BASE_USDC, amount: parseUnits(need("amount"), from.decimals).toString(), refundTo: need("refund"), recipient: v.address }),
    );
    console.log(`Send ${q.quote.amountInFormatted} ${from.symbol} on ${from.blockchain} from YOUR wallet to:\n  ${q.quote.depositAddress}\nbefore ${q.quote.deadline}.`);
    console.log(`The vault ${v.address} then receives ≈ ${q.quote.amountOutFormatted} USDC on Base. This script sends nothing.`);
    console.log(`Then: npx tsx scripts/mainnet-payout.ts status ${q.quote.depositAddress}`);
  } else if (cmd === "status") {
    console.log(JSON.stringify(await oneclick.status(process.argv[3]!), null, 2));
  } else {
    console.log("usage: npx tsx scripts/mainnet-payout.ts vault | tokens [SYMBOL] | quote | pay | fund | status <depositAddress>  (see the header)");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
