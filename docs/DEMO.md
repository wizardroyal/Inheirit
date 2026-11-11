# Demo records

## NEAR Intents on mainnet (CLAUDE.md §9A.6)

NEAR Intents has no testnet. Payouts here will be made with small real amounts from the mainnet demo vault (a Chain Signatures-derived Base address) using `scripts/mainnet-payout.ts`. Each transaction needs the human's explicit "yes" in chat before it is sent. Caps: $5 per transaction, $25 in total. The app lists the same records under "On mainnet" (`web/src/data/mainnet-payouts.json`).

| # | Feature | From | To | Deposit tx | Received tx | Status |
|---|---|---|---|---|---|---|
| 1 | Universal payout | — | — | — | — | not run yet |
| 2 | Stable-value payout | — | — | — | — | not run yet |
| 3 | Fund from anywhere | — | — | — | — | not run yet |

### What the human needs first
1. **A NEAR mainnet account** whose private key you hold. Create it with the NEAR CLI; near.com passkey accounts may not export a key. Put it in `.env` as `MAINNET_DEMO_ACCOUNT` and `MAINNET_DEMO_PRIVATE_KEY`. It needs a little NEAR for the gas of each MPC `sign` call.
2. `npx tsx scripts/mainnet-payout.ts vault` prints the Base vault address, derived by Chain Signatures from that account and `inheirit/demo/base`.
3. Fund that address on Base with about $25 USDC plus a little ETH for gas.
4. Dry run, which spends nothing: `npx tsx scripts/mainnet-payout.ts quote --to sol:USDC --amount 2 --recipient <heir address>`.
5. Real payout, which stops for your typed `yes`:
   - `npx tsx scripts/mainnet-payout.ts pay --to sol:SOL --amount 2 --recipient <addr> --link "<testnet owner>:1:0:<heir>"` (universal payout);
   - `… pay --to arb:USDC …` (stable value).
6. Funding: `npx tsx scripts/mainnet-payout.ts fund --from arb:USDC --amount 3 --refund <your Arbitrum address>`, then send from your own wallet, then `… status <depositAddress>`.

Fallback if the Chain Signatures path takes too long: set `MAINNET_DEMO_EVM_KEY` (a plain EVM wallet) instead. The README then says so.

## Dry-run quotes (read-only, 2026-11-06)

Quoted from Base USDC with `quoteWaitingTimeMs: 4000`, using a fresh random recipient address:

| Route | $5 in → out | Note |
|---|---|---|
| Base USDC → Arbitrum USDC | 4.994218 USDC | also quotes at $2 and $0.50 |
| Base USDC → Solana SOL | 0.0552 SOL | |
| Base USDC → Base ETH | 0.00222 ETH | |
| Base USDC → Base USDC | 4.9976 USDC | same-chain EVM pair quotes (v3's "same-chain doesn't quote" was NEAR→NEAR) |
| Base USDC → NEAR USDC / wNEAR | 4.9994 USDC / 1.3337 wNEAR | the NEAR recipient must be an **existing** account: `inheirit.near` (nonexistent) gave "Internal server error" |
| Base USDC → Arbitrum USDC, `confidentiality: basic` / `advanced` | 4.994218 USDC | same price as public |
| `0x…dEaD` as recipient or refundTo | rejected: "recipient is not valid" | |
