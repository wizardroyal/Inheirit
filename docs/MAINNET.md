# Mainnet runbook: NEAR Intents payouts (CLAUDE.md §9A, §13A.2)

The will runs on NEAR testnet. NEAR Intents has no testnet, so the last step (paying an heir in the asset and chain they chose) is shown on mainnet with small real amounts, from a demo vault, by `scripts/mainnet-payout.ts`. That script is the only code that can move mainnet value. It never sends without a typed `yes`, and Claude never runs a sending command without the human's explicit "yes" in chat for that transaction. Caps: $5 per transaction, $25 in total (`INTENTS_MAX_USD_PER_TX`, `INTENTS_MAX_USD_TOTAL`), tracked in `~/.config/inheirit/mainnet-ledger.json`.

What it proves, and where a judge sees it:
- **Universal payout:** what a released slice goes through: USDC paid out on Solana or Arbitrum, though the vault holds USDC on Base. Shown on `/mainnet` with explorer links on both sides.
- **Confidential payout:** the same through Confidential Intents (`confidentiality: basic`).
- **Fund from anywhere** (optional): a deposit from another chain into the vault.
- **Chain Signatures on mainnet:** the vault is a Base address derived from a NEAR mainnet account; each payout is signed by the MPC network (`v1.signer`), with the `sign` transaction linked in the output.

Everything below is read-only until step 5.

## 1. A NEAR mainnet account (about 5 minutes, ~0.2 NEAR)

Create or reuse a mainnet account in any wallet (Meteor, MyNearWallet, Intear). It needs ~0.1–0.2 NEAR for MPC `sign` gas. Export its private key (`ed25519:…`). In `.env` (never committed):

```
MAINNET_DEMO_ACCOUNT=<your-account>.near
MAINNET_DEMO_PRIVATE_KEY=ed25519:…
# optional: MAINNET_DEMO_DERIVATION_PATH=inheirit/demo/base (the default)
```

Fallback if MPC signing misbehaves: `MAINNET_DEMO_EVM_KEY=0x…` (a plain Base key) instead. The proof is weaker (no Chain Signatures), so it's a last resort.

## 2. Preflight

```bash
NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first" npx tsx scripts/mainnet-payout.ts preflight --amount 2
```

It checks the 1Click key, that the account exists and the key is on it, the derived Base vault address (printed with a Basescan link), the vault's USDC and ETH, a public and a confidential dry quote, and the caps. Lines marked `FIX` say what to do.

## 3. Fund the vault (about $12 total)

Send to the vault address from step 2, on **Base**:
- about **$10 USDC** (two $2 payouts, a spare, and room for a retry);
- about **$0.50 of ETH** for gas.

From an exchange or a wallet that supports Base. Or bring it from another chain with NEAR Intents itself:
`npx tsx scripts/mainnet-payout.ts fund --from arb:USDC --amount 5 --refund <your Arbitrum address>`. It prints a deposit address; send from your own wallet (the script never sends), then `… status <depositAddress>`. That run is the "fund from anywhere" proof.

Run preflight again until every line is `OK`.

## 4. Pick recipients

Use addresses you control, so the money comes back to you:
- Solana: a Phantom or Solflare address, for `sol:USDC`;
- Arbitrum: any EVM address of yours, for `arb:USDC`.

Optionally link each payout to a real testnet release, so `/mainnet` can say which slice it mirrors: `--link "<testnet owner>:<round>:<stage>:<heir>"`.

## 5. The two payouts (each one: preview, then "yes")

```bash
# Universal payout: USDC on Base → USDC on Solana
npx tsx scripts/mainnet-payout.ts quote --to sol:USDC --amount 2 --recipient <your Solana address>      # dry, read-only
npx tsx scripts/mainnet-payout.ts pay   --to sol:USDC --amount 2 --recipient <your Solana address>

# Confidential payout: USDC on Base → USDC on Arbitrum through Confidential Intents
npx tsx scripts/mainnet-payout.ts quote --to arb:USDC --amount 2 --recipient <your EVM address> --confidential basic
npx tsx scripts/mainnet-payout.ts pay   --to arb:USDC --amount 2 --recipient <your EVM address> --confidential basic
```

`pay` takes a fresh quote, prints every field (from, to, amount, minimum out, fees, refund address, caps), and waits for `yes`. Then the MPC network signs, the USDC goes to the one-time deposit address, the deposit is reported to 1Click, and the script polls until `SUCCESS` (or `REFUNDED`, which returns the money to the vault). It records the result in `web/src/data/mainnet-payouts.json`.

## 6. Publish the proof

```bash
git add web/src/data/mainnet-payouts.json && git commit -m "Mainnet payouts" && git push origin web-day4 web-day4:main
```

Vercel redeploys and `/mainnet` lists both payouts with "Sent from the vault" and "Received by the heir" links. The `/mainnet` copy switches from "can go out" to "went out" by itself once a record exists. Add the links to the table in `docs/DEMO.md`.

## If something goes wrong

- **Quote fails** with "recipient is not valid": a wrong-format address for that chain.
- **MPC sign is slow:** it can take up to a minute; the script waits.
- **`REFUNDED`:** the USDC went back to the vault; run `pay` again (it counts toward the caps).
- **Stuck in `PROCESSING`:** `npx tsx scripts/mainnet-payout.ts status <depositAddress>` later.
- **Caps:** raise them only with the human's say-so: `INTENTS_MAX_USD_PER_TX=…`.
