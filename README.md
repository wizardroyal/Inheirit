# Inheirit — a will that doesn't make you prove you're alive

Built at **NEAR HACKATHON** (November 2026).

**Testnet: fully self-serve. Mainnet: live NEAR Intents quotes, and real payouts only through a script a person approves one transaction at a time. Public mainnet vaults wait for a production TEE framework and an audit.**

Inheirit notices the signs of life you already give off, privately, and only reaches out when you've gone quiet for longer than usual. It **never acts on silence alone**: people have to confirm you're gone, and you get a loud challenge period to say otherwise. Only then does it hand your assets on across **NEAR, Ethereum and Bitcoin**, in small, reversible slices. Sealed instructions for everything else reach the right heir **last**.

**Try it:** https://inheirit.vercel.app · Live mainnet quotes: https://inheirit.vercel.app/mainnet · Agent (TEE): https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network · Contract: [`inheirit.testnet`](https://testnet.nearblocks.io/address/inheirit.testnet)

## Four ideas the design rests on

1. **Passive liveness is safe only because of an asymmetry.** Signals can stop the will. Only people can start it: a quorum of guardians who accepted the role, then a challenge period.
2. **The first release is the loudest alarm.** A 10% slice leaving your vaults, with heirs notified, is when a living owner notices. So the *longest wait* comes right after the first slice, and a false trigger costs at most that slice.
3. **Secrets come last.** Funds move in slices, but a revealed secret can never be taken back. Sealed notes are released only after distribution completes, plus one more wait.
4. **Private by construction.** The agent reads signals inside a TEE and only timestamps leave it. In-product AI uses only an attested NEAR AI Cloud model.

**Your heirs receive what they actually use.** Each heir chooses the asset and chain they're paid in (USDC on Base, SOL on Solana, NEAR…), and every released slice goes on to them through **NEAR Intents**. Owners can choose **stable value**, so each slice is converted to US dollars as it's released and heirs aren't exposed to price swings during a release that takes months. A will can also be **funded from anywhere**, from whatever token and chain the owner holds.

Inactivity-based tools exist, such as Google Inactive Account Manager and Bitcoin timelock wallets. What's new is the combination: many weighted sources read privately in a TEE, a human escalation ladder before anything moves, staged cross-chain execution, and secrets last.

## The problem

Billions in crypto are lost when holders die or become incapacitated. Earlier attempts mostly solved the *transfer* and failed on the *humans*:

| Problem | Why past attempts failed | What Inheirit does |
|---|---|---|
| Check-in fatigue | Dead-man's switches make you prove you're alive every month. People forget. | No check-ins. The agent notices activity you already produce, and asks (heartbeat app, Telegram) only when you've gone quiet. |
| False triggers | A hospital stay, a retreat or a lost phone looks like death to a timer. | Silence alone can never execute. It takes a guardian quorum, then a challenge period that any sign of life cancels. |
| Single chain | Bitcoin-only timelocks, EVM-only contracts. | One will across NEAR, Ethereum (Sepolia) and Bitcoin (testnet4) via NEAR Chain Signatures. |
| Heirs can't claim | Heirs don't know the assets exist, or don't have the right wallet for the right chain. | A guided claim page, an AI guide that sees only the heir's own details, and payouts in whatever asset and chain the heir already uses (NEAR Intents). |
| Secrets in a public will | A seed phrase can't go into a will that becomes public. | Sealed notes, encrypted in the browser to a TEE key and re-sealed to the heir only after distribution completes. |
| No undo | Once triggered, everything moves at once. | 10% → 20% → 30% → 40%, with the longest wait after the first slice. Any sign of life stops the rest, and the secrets. |

## Try it in 3 minutes (no wallet, no money)

Everything runs on testnet. One path, start to finish:

1. Open **https://inheirit.vercel.app/owner** and click **Try with a demo account**. You get a fresh, funded testnet account whose key stays in your browser, and a random username such as *HatYoungRace* (click **Rename** to change it). A NEAR testnet wallet or Google sign-in works too.
2. Click **Generate a sample will for me**, then **Generate my will** (under a minute). It creates an heir (Ada), three guardians, a friend and a lawyer, writes the will (everything to Ada, 10% → 20% → 30% → 40%), has the guardians accept (the will is now **armed**), funds the vaults and seals a note for Ada.
   → The dashboard opens at **All good**: the *Signs of life* panel shows the ladder, a countdown, the agent's plain-English verdict and "What the agent saw: timestamps only".
3. **Set your will in motion** is already on scenario **a · The owner comes back**, with demo timings (quiet after 2 minutes instead of 90 days). Do nothing for about 2 minutes.
   → The ladder climbs to **Quiet**, and the checks appear under *Messages sent* (heartbeat app, email, Telegram if linked, a SIMULATED DM), then **Welfare check**.
4. Click **I'm here (send a heartbeat)**.
   → Within seconds the ladder **snaps back to All good**, and the verdict says nothing moved. That's the whole idea: signals can stop it; only people can start it.

## Then the full run (about 15 minutes)

Pick another scenario on the same card. The card shows a checklist with a button for each step you take.
- **b · The will is carried out.** Click **Create Ada's key**, wait for **Guardian vote** (about 4 minutes), then **Both guardians confirm**. → **Challenge period** (2 minutes), then **Releasing in stages**: 10% lands on NEAR, Sepolia and BTC testnet4, with explorer links under *Released so far*. The next slice waits **3 minutes**, the longest wait; then 20%, 30%, 40% a minute apart; then **Waiting before secrets**, then **Secrets released**. Click **Open Ada's view** → **Open the note**: *"The Ledger is in the blue folder in the study…"*, sealed in your browser and opened only with Ada's key.
- **c · A lawyer speeds it up.** Once the guardian vote has started, click **File the death certificate** (the evidence is SIMULATED), then **Both guardians confirm**. → The challenge period still runs in full; the release then follows the faster 10% → 30% → 60% schedule.
- **d · The heir chooses late.** Don't set Ada's payout. → After the release starts, *Payouts to heirs* says Ada's inheritance is waiting. Open Ada's view, choose e.g. **USDC on Base** with an address, and **Save** → the waiting slices pay out together (SIMULATED NEAR Intents on testnet, priced live).

**View as** (on the same card) opens the guardian, heir, friend and lawyer pages as those accounts; each links back to the owner. On Ada's page, once an address is entered, **Get live quotes** shows real NEAR Intents quotes from mainnet, public and confidential side by side (dry runs: no money moves). The same quote is on **https://inheirit.vercel.app/mainnet**. Afterwards: **Back to real timings**, or, once Completed, **Start over with the same people**.

**At any step, try to break the rule "signals stop it, people start it":** on the [control panel](https://inheirit.vercel.app/demo), a lone **X post** (SIMULATED) is ignored on purpose, and the verdict says why (*"ignored on its own because posts can be scheduled or run by someone else"*). Two weak sources within 24 hours, or any strong one, do count. A will whose guardians haven't accepted never leaves All good, however long the silence.

**Advanced:** the [control panel](https://inheirit.vercel.app/demo) (`/demo`) is a lower-level control room for the same flow: **Create a demo cast**, **Create the demo will**, then the guardian and signal buttons. Scenario A and B there match `scripts/demo-cancel.ts` and `scripts/demo-execute.ts`.

**Your own will** (`/owner`): instead of generating one, use **Quick setup (3 steps)** (signals, people, vault; a live "who gets what" preview; "if you go quiet, the earliest anything moves is about…") or **Write it in plain English** (a private NEAR AI model drafts it, our code checks it, and you approve a summary that code, not the model, wrote). The **Will strength** checklist shows what arms the will and what makes it stronger, including **Link Telegram**: if you go quiet, the bot checks in, and any reply cancels. Guardians accept at `/guardian/<owner>`; `/heartbeat` is an installable app.

## How it works

```
 signals (NEAR txs · Sepolia txs · heartbeat app · Telegram replies · GitHub ·
          SIMULATED: calendar, mail, X, Instagram, TikTok, Facebook, WhatsApp, LinkedIn)
        │  timestamps only
        ▼
 ┌──────────────────────────────┐ record_liveness / advance ┌──────────────────────────────┐
 │ Will agent (Shade Agent,     │──────────────────────────▶│ inheirit.testnet (Rust)      │
 │ Intel TDX on Phala)          │                           │ will state machine, guardians│
 │ scoring · verdict · checks · │◀── gated request_signature│ NEAR vault, signing gate     │
 │ executor · sealed notes      │                           └───────────┬──────────────────┘
 └──────┬───────────────┬───────┘                                       │ sign (only while Executing,
        │               │ NEAR AI Cloud (attested TEE model)            ▼  or an owner withdrawal)
        │               └─ plain-English will → policy; heir guide   MPC signer v1.signer-prod.testnet
        ├──▶ Sepolia · BTC testnet4 (signed vault transfers)
        ├──▶ NEAR Intents 1Click (SIMULATED on testnet; live prices)
        └──▶ Telegram bot (check messages; replies count as signs of life)

 web (Next.js on Vercel): owner, guardian, lawyer, friend and heir pages · sign-in (wallet, Google, demo)
                          · /api/onboard (creates testnet accounts from browser-made public keys)
                          · /api/quote (live mainnet 1Click dry quotes, public and confidential)
```

**The ladder:**
1. **All good** (armed only once enough guardians accept).
2. **Quiet:** checks go out to the heartbeat app, email, Telegram, then DMs.
3. **Welfare check:** guardians, friends and the lawyer are asked whether they've heard from you.
4. **Guardian vote:** one "they're alive" stops it.
5. **Challenge period:** you're alerted everywhere.
6. **Releasing in stages:** 10% → *longest wait* → 20% → 30% → 40%.
7. **Waiting before secrets.**
8. **Secrets released.**
9. **Completed.**

**Signals vs checks.**
- A strong signal (a signed NEAR or Sepolia transaction, a heartbeat) or a medium one (a Telegram reply) counts on its own.
- A weak signal (a social post, GitHub) counts only if a second, different source agrees within 24 hours.
- Any counted sign of life sends the will back to the top, even mid-release or while waiting before secrets.

**Acceleration.** A lawyer, or the guardian quorum with evidence, can attest a death certificate. That switches the remaining stages to a faster schedule (10/30/60, shorter waits). It never skips the guardian vote, the challenge period or a stage.

## NEAR technology used, and where

| Tech | Used for | Code |
|---|---|---|
| NEAR smart contract (Rust, near-sdk 5) | Will state machine (stage waits, secrets buffer, guardian consent, lawyer acceleration, Start over), NEAR vault, signing gate, sealed-note storage, NEP-297 events | `agent-contract/src/will/` (161 unit tests, sandbox tests in `agent-contract/tests/will_flow_tests.rs`) |
| **Chain Signatures** (`v1.signer-prod.testnet`) | Vault addresses on Sepolia and BTC testnet4, derived from the contract account (`heirloom/<owner>/eth\|btc`); release and withdrawal signatures | gate: `agent-contract/src/will/agent.rs`; tx building: `src/chains/evm.ts`, `src/chains/btc.ts` (chainsig.js) |
| **Shade Agent Framework** (TEE on Phala) | The will agent: liveness scoring and verdict, escalation and checks, execution, sealed-note crypto, Telegram bot. Registered with a real TDX attestation; measurements approved on-chain. | `src/index.ts`, `src/escalation/`, `src/liveness/`, `src/executor/`, `src/sealed/`, `src/telegram/`, `scripts/tee-agent.ts` |
| **NEAR AI Cloud** (private inference) | Plain-English will → structured policy; heir claim guide. Will text goes only to a model whose attestation passes (TDX quote, NVIDIA GPU, signer bound to a fresh nonce; checked at startup and before each use), and every answer's signature must recover to the attested signer. | `src/ai/attestation.ts`, `src/ai/nearai.ts`, `src/ai/policy-parser.ts`, `src/ai/heir-guide.ts` |
| **NEAR Intents** (1Click API) | Universal payout: each released slice goes on to the heir's chosen asset and chain; stable value (USDC); fund from anywhere. On testnet the agent uses a SIMULATED 1Click client with live prices. Heirs see live mainnet dry quotes, public and confidential. Real mainnet payouts come from a Chain Signatures-derived Base vault via an approval-gated script. | `src/intents/oneclick.ts`, `src/intents/payout.ts`, `web/src/app/api/quote/route.ts`, `web/src/components/Payouts.tsx`, `web/src/app/mainnet/page.tsx`, `scripts/mainnet-payout.ts` |
| NEAR Wallet Selector + named accounts | Sign in with MyNearWallet, Meteor or Intear; Google and demo users get `<id>.inheirit-users.testnet` accounts whose key is generated in their browser | `web/src/lib/wallet.ts`, `web/src/lib/onboard.ts`, `web/src/app/api/onboard/route.ts` |
| NEP-413 signed messages | Owner-signed requests to the agent (heartbeat, watch settings, Telegram link, drafting, guide, demo faucet), and heir-signed payout choices, checked against the account's on-chain keys | `src/auth/nep413.ts`, `web/src/lib/near.ts`, `web/src/lib/wallet.ts` |

## Privacy

- **What runs in the TEE:** the agent. It polls signal sources, scores liveness, signs releases, runs the Telegram bot, and holds the sealed-notes private key. That key is derived from Phala's KMS for this app (`getKey`) and kept only in memory.
- **What leaves it:** timestamps (`record_liveness`), state transitions, signed transfers, and notes re-sealed to an heir's key. Signal adapters return the time of the latest activity, never content. A Telegram reply is recorded as its receive time only; its text is never stored or logged.
- **Sealed notes:** encrypted in the owner's browser (libsodium sealed box) to the agent's key; only ciphertext goes on-chain. Once the will reaches *Secrets released*, the agent opens each note inside the TEE and re-seals it to the heir's X25519 key, and the heir decrypts it in their browser.
- **Will text** is processed only by an attested NEAR AI Cloud model. We verified that only 12 of 61 listed models attest; proxied models are refused.
- **Minimal data:** sign-up asks for a display name and, optionally, a jurisdiction. Nothing else: no date of birth, nationality or photo. Google sign-in names the account after a hash of Google's user id; the email never goes on-chain, and we never hold the account's key.
- **In the UI:** the *Signs of life* panel says "What the agent saw: timestamps only", next to badges for the attested TEE agent (approved compose hashes, registered agent, sealed-notes key match) and for the NEAR AI model (each check of a fresh attestation).

## Threat model

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). In short:
- A greedy heir needs colluding *accepted* guardians *and* the owner's silence through a loud challenge period. Even then, a false trigger costs at most the first 10% before the long wait.
- A lawyer colluding with an heir can only shorten the waits, never skip a step.
- Outsiders can't move vault funds: only the attested agent can request signatures, and only while a will is executing.
- The developer can't read notes without shipping new agent code, which shows up as a new compose hash (with the caveat about Phala's centralized KMS below).
- Two adversarial passes and an independent audit are recorded, finding by finding, in `CLAUDE.md` (Decision log, 2026-11-06 and 2026-11-11). Each fix has a test.

## Honest limitations

- **Experimental stack.** The Shade Agent Framework is unaudited and testnet-only. The will runs on NEAR testnet, Sepolia and BTC testnet4.
- **Vault model.** Assets must be moved into vaults the will controls: the NEAR vault in the contract, and Sepolia/BTC addresses derived by Chain Signatures. The owner can withdraw while the will is at All good.
- **Simulated signals**, labelled SIMULATED in the UI: Google Calendar, Gmail, X, Instagram, TikTok, Facebook, WhatsApp, LinkedIn. Real: NEAR transactions, Sepolia transactions, the signed heartbeat, Telegram replies, GitHub.
- **Email** checks are shown in the app; no email is sent yet.
- **Heirs are hidden in the UI only.** The app and agent don't reveal heirs before the release, but heir accounts and NEAR shares are in contract state, which anyone can read. Commit-reveal is on the roadmap.
- **Payload-blind gate.** The contract decides *when* and *which vault* can be signed, not *what* the transaction says. That rests on the attested agent code and a per-stage signature cap.
- **Centralized KMS.** With Phala's KMS, whoever controls the Phala account could push new agent code that derives the same sealed-notes key. Every deployed compose hash is published (`deploy/tee-agent.json`) and must be approved on the contract to register. An on-chain KMS with a timelocked allowlist is on the roadmap.
- **Key persistence.** The sealed-notes key is tied to one Phala app; the agent is upgraded in place and never re-created. Losing that app means owners must re-seal their notes.
- **Not built yet:**
  - enforcing policy `conditions` (e.g. "not before 2031"), which are parsed and shown;
  - an adaptive "your normal" baseline: the quiet threshold is a fixed setting per will.
- **Expired guardian votes restart the ladder.** If guardians don't vote, the will returns to All good without a new sign of life, so the ladder starts again at once (about every 7 minutes on demo timings). The repeated checks and welfare messages appear in the app, but Telegram sends each of them only once per silence. The challenge alarm is always sent.
- **NEAR Intents is SIMULATED on testnet.** NEAR Intents has no testnet. The testnet slices are real transfers; the swap that takes them on to the heir's choice runs on a simulated 1Click client (live prices, fake deposit address). On mainnet: heirs see live dry quotes, and real payouts can be sent from our demo vault only by a local script (`scripts/mainnet-payout.ts`) that asks a person for approval before every transaction (caps: $5 each, $25 in total). Any made are listed at `/mainnet`. In production, the attested agent's mainnet contract would sign these legs.
- **Payout waiting happens after the vault.** If an heir hasn't chosen how to be paid, their onward payout waits and later slices are paid together. The testnet slice itself still leaves the vault on schedule. Holding it in the vault would need a contract change (roadmap).
- **Usernames are local.** The random three-word username (and any rename) lives in your browser; the testnet account id stays the on-chain identity, and other browsers see the account id.
- **Browser-held keys.** Demo and Google accounts keep their key in your browser (back it up with **Download key backup**). A lost browser means a lost testnet account. Wallet users keep their keys in their wallet.
- **Speedruns expire.** On the hosted demo, the agent stops watching a will on demo timings a few hours after it started (never mid-release, in the guardian vote or in the challenge period). Wills on real timings are watched indefinitely.
- **Start over clears the old record.** Replacing a Completed will keeps released notes and leftover NEAR, but drops the old will's execution records, so onward payouts still waiting for an heir's choice from that run are dropped too.

## Roadmap

- **Beyond wills: conditional gifts.** The will is the first product of a conditional-release engine: time or milestone conditions, attested by people, with a challenge window and staged release. The `not_before` condition (parsed and shown today) is the first example. Milestones and dates only; never conditions on relationships, beliefs or lifestyle.
- A human adjudicator for disputes and heir support.
- Real Gmail, Calendar, X, Instagram, WhatsApp and LinkedIn adapters, with OAuth tokens kept in the TEE.
- An adaptive baseline per source.
- Incapacity mode: a capped caretaker allowance via function-call keys.
- Fire-drill mode, and stale-will review.
- A lawyer companion letter.
- Gasless heir claims.
- Bank and Cash App payouts for heirs without crypto.
- **Private inheritance with Confidential Intents:** payouts that observers can't trace from the will's release to the heir's receipt. Confidential quotes already work; heirs see them next to public ones.
- **Intents-native vault:** the will holds every asset as a NEAR Intents balance, distributes by internal transfer, and heirs withdraw to any chain. One vault for every asset, and instant cross-chain payout. A dry 1Click quote from an Intents balance to USDC on Base already succeeds.
- Self-funding upkeep: the agent pays its own inference and hosting via Intents, and tops up gas for vaults and heirs.
- Contract-level heir hiding (commit-reveal).
- An on-chain KMS with a timelocked compose allowlist.

## Run it yourself

```bash
npm ci                                  # agent (repo root)
cp .env.example .env                    # AGENT_CONTRACT_ID, SPONSOR_*, NEARAI_API_KEY, DEMO_MODE=true (TELEGRAM_* optional)
npm test                                # agent tests (220)
npm run dev                             # agent on :3000
cd web && npm ci && cp .env.example .env.local && npm run dev -- -p 3100   # web on :3100
```

Contract: `cd agent-contract && cargo +1.86.0 test --lib` (161 unit tests). The sandbox tests (`cargo +1.86.0 test --tests`) need the wasm at `target/near/shade_contract_template.wasm` first: `cargo +1.86.0 near build non-reproducible-wasm --no-abi` (or the pinned `sourcescan/cargo-near` Docker image).

Headless scenario scripts:
- `scripts/demo-cancel.ts`: Scenario A.
- `scripts/demo-execute.ts`: Scenario B on three chains.
- `scripts/demo-sealed-note.ts`: English will → sealed note → heir decrypts, secrets last.
- `scripts/demo-accelerate.ts`: lawyer death proof → accelerated schedule; the challenge period is kept.
- `scripts/demo-telegram.ts`: an unarmed will stays at All good; a Telegram reply cancels Quiet.
- `scripts/demo-payout.ts`: Scenario B with NEAR Intents payouts (SIMULATED): two heirs, stable value, one heir choosing late.
- `scripts/load-test.ts`: many concurrent speedrun wills against one agent.
- `scripts/mainnet-payout.ts`: the **mainnet** NEAR Intents demo (vault address, dry quotes, approval-gated payouts and funding; caps $5 per transaction, $25 in total).

Helpers: `scripts/fund-vaults.ts`, `scripts/new-funder.ts`. Deploying: [`docs/DEPLOY.md`](docs/DEPLOY.md). The project brief and every decision with its evidence: [`CLAUDE.md`](CLAUDE.md).

## Credits

- Built on the [Shade Agent template](https://github.com/NearDeFi/shade-agent-template) by NEAR (Apache-2.0); see `LICENSE`, `NOTICE.txt`, `LICENSE-THIRD-PARTY.txt`.
- NEAR AI attestation checks adapted from [nearai/nearai-cloud-verifier](https://github.com/nearai/nearai-cloud-verifier) (MIT, `src/ai/LICENSE-nearai-cloud-verifier`).
- Built with Claude Code.
