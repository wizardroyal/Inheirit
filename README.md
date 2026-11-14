# Inheirit — a will that doesn't make you prove you're alive

Billions in crypto are lost when people die. Crypto wills try to fix that with dead-man's switches: check in every month, or your assets go to your heirs. But people forget, and a long holiday or a hospital stay looks exactly like death to a timer.

**Inheirit asks nothing of you while you're alive.** An agent in a secure enclave notices the signs of life you already give off (wallet transactions, a tap in the heartbeat app, Telegram replies, GitHub) and keeps only timestamps. When you go quiet for much longer than usual, it checks on you, then asks your friends and guardians. Silence alone never moves anything: guardians must confirm, you get a long challenge period, and one sign of life at any point stops it. Then your assets go to your heirs in stages across **NEAR, Ethereum and Bitcoin**, and sealed notes (where the hardware wallet is, who holds the passphrase) reach each heir last.

Built at **NEAR HACKATHON** (November 2026) with Chain Signatures, Shade Agents, NEAR AI Cloud and NEAR Intents.

**Try it:** https://inheirit.xyz (testnet, no wallet needed) · **Demo video (99 s, three scenarios):** https://x.com/augoustics/status/2121414609588416536 · Contract: [`inheirit.testnet`](https://testnet.nearblocks.io/address/inheirit.testnet) · Agent (TEE): https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network

<p align="center">
  <img src="docs/screenshots/snapback.gif" alt="The owner goes quiet and the ladder climbs; one heartbeat snaps it back to All good and nothing moves" width="640">
  <br><sub>Recorded on the live site (testnet + the TEE agent): three minutes of silence, sped up, then one heartbeat. Nothing moved.</sub>
</p>

<p align="center">
  <img src="docs/screenshots/heir-received.png" alt="The heir's page: four stages received on NEAR, Ethereum and Bitcoin, each with an explorer link" width="640">
  <br><sub>What an heir sees after a release: four stages, three chains, every transfer linked to its explorer.</sub>
</p>

## The four ideas it rests on

1. **Signals can stop it; only people can start it.** Passive liveness is safe only because of this asymmetry. Any sign of life cancels the process at any step. Starting a release takes guardians who accepted the role, then a challenge period.
2. **The first release is the loudest alarm.** A 10% slice leaving your vaults, with heirs notified, is when a living owner notices. So the longest wait comes right after the first slice, and a false alarm costs one slice at most.
3. **Secrets come last.** Money can be released in slices; a revealed secret can't be taken back. Sealed notes are released only after everything else is handed over, plus one more wait.
4. **Private by construction.** The agent reads signals inside an Intel TDX enclave and only timestamps leave it. The only AI that sees will text is an attested private model on NEAR AI Cloud.

**No NEAR account needed for the people around you.** Guardians, friends and a lawyer get a one-time link, sign in with Google and accept. Heirs are paid in what they actually use (USDC on Base, SOL, NEAR…) through NEAR Intents. And if you don't want to move money at all, a **notes-only will** hands on just the sealed instructions.

## Try it in 3 minutes (no wallet, no money)

Everything runs on testnet, in your browser:

1. Open **https://inheirit.xyz/account** and click **Try with a demo account**. You get a fresh, funded testnet account whose key stays in your browser.
2. Click **Generate a complete will (1 click)**. It creates test people (an heir, three guardians, a friend, a lawyer), funds the vaults, adds a sealed note and starts the will on a clock of minutes. About a minute.
   → You land on **Try a speedrun**, scenario **a · The owner comes back**.
3. Do nothing for about 2 minutes.
   → The ladder climbs to **Quiet**, then **Welfare check**. The checks it sent are under **Activity**.
4. Click **I'm here (send a heartbeat)**.
   → Within seconds it **snaps back to All good**: "Cancelled; nothing moved."

Real timings are months (a quiet period of 60 days by default, then 14, 30 and 60 days for each step); the speedrun runs the same ladder in minutes.

## Then the full run (about 15 minutes)

On **Try a speedrun**, the card shows a checklist with a button for each step you take.

- **Someone has heard from you.** On scenario a, wait for **Welfare check**, then **View as** → the friend → *Have you heard from …?* → **Yes, they're fine**. → Back to **All good**. Guardians get the same question, and in the guardian vote one "they're alive" stops everything. People can stop a release; nobody can start one alone.
- **b · The will is carried out.** Click **Create &lt;heir&gt;'s key**, wait for **Guardian vote** (about 4 minutes), then **Both guardians confirm**. → **Challenge period** (2 minutes), then **Releasing in stages**: 10% lands on NEAR, Ethereum (Sepolia) and Bitcoin (testnet4), with explorer links under **Activity**. The next slice waits 3 minutes, the longest wait; then 20%, 30% and 40% a minute apart; then **Waiting before secrets** and **Secrets released**. Click **Open &lt;heir&gt;'s view** → **Open the note**: *"The Ledger is in the blue folder in the study…"*, opened in the browser with the heir's own key.
- **c · A lawyer speeds it up.** Once the guardian vote has started, click **File the death certificate** (the evidence is SIMULATED), then **Both guardians confirm**. → The challenge period still runs in full; the release then follows a faster 10% → 30% → 60% schedule.
- **d · The heir chooses late.** Don't set the heir's payout. → After the release starts, **Vault** → *Payouts to heirs* shows slices waiting. Open the heir's view, choose e.g. **USDC on Base** with an address, and **Save my choice** → the waiting slices pay out together (NEAR Intents is SIMULATED on testnet, priced with live mainnet quotes).

**View as** opens the guardian, heir, friend and lawyer pages as those accounts. On the heir's page, **Get live quotes** shows real NEAR Intents quotes from mainnet, public and confidential side by side.

**Advanced:** the [control panel](https://inheirit.xyz/demo) (`/demo`) runs the same flow at a lower level. Try to break "signals stop it, people start it" there: once the will has left All good, a lone **X post** (SIMULATED) doesn't count and the verdict says why; two weak sources within 24 hours, or any strong one, do. A will whose guardians haven't accepted never leaves All good. The same steps run headlessly in `scripts/demo-cancel.ts` and `scripts/demo-execute.ts`.

## For judges: where to check each claim

| Claim | How to check it |
|---|---|
| Silence climbs the ladder; one sign of life snaps it back | [Try it in 3 minutes](#try-it-in-3-minutes-no-wallet-no-money) on the live app |
| Real cross-chain release in stages: NEAR, Ethereum (Sepolia), Bitcoin (testnet4) | [The full run](#then-the-full-run-about-15-minutes), scenario b: explorer links under **Activity** and on the heir's page |
| The agent runs in an attested TEE, and only it can request signatures | `npx tsx scripts/verify.ts`: one read-only command, PASS/FAIL per check ([`docs/VERIFY.md`](docs/VERIFY.md)); every deployed compose hash is in [`deploy/tee-agent.json`](deploy/tee-agent.json) |
| Private AI | Trust badges under *Signs of life* (fresh attestation of the NEAR AI Cloud model); code in `src/ai/attestation.ts` |
| NEAR Intents | Live mainnet quotes on the heir page and [`/mainnet`](https://inheirit.xyz/mainnet); two real mainnet payouts ([below](#near-intents-on-mainnet)) |
| Tests and security work | 266 agent tests and 196 contract unit tests plus sandbox flows, on every push ([CI](.github/workflows/ci.yml)); review rounds summarised in [`docs/AUDITS.md`](docs/AUDITS.md) |
| What's real and what's simulated | [Real vs simulated](#real-vs-simulated) |

## Screens

All from the live site, recorded 2026-11-13.

| | |
|---|---|
| <img src="docs/screenshots/guardian-answers.gif" alt="A guardian answers Have you heard from John Chukwu? with Yes, they're fine, and the will goes back to All good" width="100%"><br><sub>Someone close answers "Yes, they're fine": back to All good.</sub> | <img src="docs/screenshots/heir-note.jpg" alt="The heir opens John Chukwu's sealed note: The Ledger is in the blue folder in the study" width="100%"><br><sub>Secrets come last: the heir opens the sealed note with her own key.</sub> |
| <img src="docs/screenshots/my-will.jpg" alt="My will: the will written out in plain sentences, with status, heirs, guardians, lawyer and friends" width="100%"><br><sub>My will, in plain sentences.</sub> | <img src="docs/screenshots/signs-of-life.jpg" alt="Signs of life: ranked sources, heartbeat app first, and the quiet period" width="100%"><br><sub>Signs of life: what counts, and how strongly.</sub> |
| <img src="docs/screenshots/vault.jpg" alt="Vault: holdings on NEAR, Ethereum and Bitcoin in dollars, with deposit and withdraw" width="100%"><br><sub>One vault across NEAR, Ethereum and Bitcoin.</sub> | <img src="docs/screenshots/final-secrets.jpg" alt="Final secrets: sealed notes per heir, released last" width="100%"><br><sub>Final secrets: sealed per heir, released last.</sub> |

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

## How it works

```
 signals (NEAR txs · Sepolia txs · heartbeat app · Telegram replies · GitHub ·
          SIMULATED: calendar, mail, X, Instagram, TikTok, Facebook, LinkedIn)
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
2. **Quiet:** after silence longer than your usual. At setup the app reads your own NEAR (and Sepolia) history, finds your typical gap between transactions, and suggests 3× it (at least 30 days; 60 days when there is too little history); you choose the number. The verdict then says "quiet 9 days (usually active every 3 days)". Checks go out to the heartbeat app, email, Telegram, then DMs.
3. **Welfare check** (14 days): guardians, friends and the lawyer are asked whether they've heard from you.
4. **Guardian vote** (30 days): one "they're alive" stops it.
5. **Challenge period** (60 days): you're alerted everywhere.
6. **Releasing in stages:** 10% → *6 months, the longest wait* → 20% → 3 months → 30% → 3 months → 40%.
7. **Waiting before secrets** (3 months).
8. **Secrets released.**
9. **Completed.**

**Signals vs checks.**
- A strong signal (a signed NEAR or Sepolia transaction, a heartbeat) or a medium one (a Telegram reply) counts on its own.
- A weak signal (a social post, GitHub) counts only if a second, different source agrees within 24 hours.
- Any counted sign of life sends the will back to the top, even mid-release or while waiting before secrets.

These are the real defaults; every number is the owner's to change, and the speedrun runs the same ladder in minutes. A will shouldn't panic; the accelerated path covers urgent needs like funeral costs.

**Acceleration.** A lawyer, or the guardian quorum with evidence, can attest a death certificate. That switches the remaining stages to a faster schedule (10/30/60, 14 days apart). It never skips the guardian vote, the challenge period or a stage.

## NEAR technology used, and where

| Tech | Used for | Code |
|---|---|---|
| NEAR smart contract (Rust, near-sdk 5) | Will state machine (stage waits, secrets buffer, guardian consent, lawyer acceleration, Start over, one-time invite links), NEAR vault, signing gate, sealed-note storage, NEP-297 events | `agent-contract/src/will/` (196 unit tests, sandbox tests in `agent-contract/tests/will_flow_tests.rs`) |
| **Chain Signatures** (`v1.signer-prod.testnet`) | Vault addresses on Sepolia and BTC testnet4, derived from the contract account (`heirloom/<owner>/eth\|btc`); release and withdrawal signatures | gate: `agent-contract/src/will/agent.rs`; tx building: `src/chains/evm.ts`, `src/chains/btc.ts` (chainsig.js) |
| **Shade Agent Framework** (TEE on Phala) | The will agent: liveness scoring and verdict, escalation and checks, execution, sealed-note crypto, Telegram bot. Registered with a real TDX attestation; measurements approved on-chain. | `src/index.ts`, `src/escalation/`, `src/liveness/`, `src/executor/`, `src/sealed/`, `src/telegram/`, `scripts/tee-agent.ts` |
| **NEAR AI Cloud** (private inference) | Plain-English will → structured policy; heir claim guide. Will text goes only to a model whose attestation passes (TDX quote, NVIDIA GPU, signer bound to a fresh nonce; checked at startup and before each use), and every answer's signature must recover to the attested signer. | `src/ai/attestation.ts`, `src/ai/nearai.ts`, `src/ai/policy-parser.ts`, `src/ai/heir-guide.ts` |
| **NEAR Intents** (1Click API) | Universal payout: each released slice goes on to the heir's chosen asset and chain; stable value (USDC); fund from anywhere. On testnet the agent uses a SIMULATED 1Click client with live prices. Heirs see live mainnet dry quotes, public and confidential. Two real mainnet payouts (public and confidential) were sent from a Chain Signatures-derived Base vault, through an approval-gated script (listed on `/mainnet`). | `src/intents/oneclick.ts`, `src/intents/payout.ts`, `web/src/app/api/quote/route.ts`, `web/src/components/Payouts.tsx`, `web/src/app/mainnet/page.tsx`, `scripts/mainnet-payout.ts` |
| NEAR Wallet Selector + named accounts | Sign in with MyNearWallet, Meteor or Intear; Google and demo users get `<id>.inheirit-users.testnet` accounts whose key is generated in their browser | `web/src/lib/wallet.ts`, `web/src/lib/onboard.ts`, `web/src/app/api/onboard/route.ts` |
| NEP-413 signed messages | Owner-signed requests to the agent (heartbeat, watch settings, Telegram link, drafting, guide, demo faucet), and heir-signed payout choices, checked against the account's on-chain keys | `src/auth/nep413.ts`, `web/src/lib/near.ts`, `web/src/lib/wallet.ts` |

## Why NEAR

A will has to outlive its owner's devices, and Inheirit needs four things that are rare to find on one chain:
- **One account that signs on every chain.** Chain Signatures let a single NEAR contract hold and release ETH and BTC, with no bridges and no keys for anyone to lose.
- **An agent you don't have to trust.** Shade Agents run the liveness logic in a TEE and register with an attestation the contract checks, so the code that can move money is the code that was approved.
- **Private AI.** NEAR AI Cloud serves attested models, so the wording of a will can be drafted with AI without becoming training data or a leak.
- **Payouts in what heirs use.** NEAR Intents turns a release into whatever asset and chain each heir wants, which is the difference between an heir being paid and an heir being stuck.

Named accounts and function-call keys make the human side workable: readable names for guardians and heirs, and limited keys for a heartbeat device.

## Privacy

- **What runs in the TEE:** the agent. It polls signal sources, scores liveness, signs releases, runs the Telegram bot, and holds the sealed-notes private key. That key is derived from Phala's KMS for this app (`getKey`) and kept only in memory.
- **What leaves it:** timestamps (`record_liveness`), state transitions, signed transfers, and notes re-sealed to an heir's key. Signal adapters return the time of the latest activity, never content. A Telegram reply is recorded as its receive time only; its text is never stored or logged.
- **Sealed notes:** encrypted in the owner's browser (libsodium sealed box) to the agent's key, sealed together with the owner and heir they were written for; only ciphertext goes on-chain, and the agent releases a note only inside that will and only to that heir. Once the will reaches *Secrets released*, the agent opens each note inside the TEE and re-seals it to the heir's X25519 key, and the heir decrypts it in their browser.
- **Will text** is processed only by an attested NEAR AI Cloud model. When we checked (2026-10-27), only 12 of 61 listed models returned an attestation; the agent refuses any model that doesn't.
- **Minimal data:** sign-up asks for a display name and, optionally, a jurisdiction. Nothing else: no date of birth, nationality or photo. Google sign-in names the account after a hash of Google's user id; the email never goes on-chain, and we never hold the account's key.
- **In the UI:** the *Signs of life* panel says "What the agent saw: timestamps only", next to badges for the attested TEE agent (approved compose hashes, registered agent, sealed-notes key match) and for the NEAR AI model (each check of a fresh attestation).

## Threat model

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). In short:
- A greedy heir needs colluding *accepted* guardians *and* the owner's silence through a loud challenge period. Even then, a false trigger costs at most the first 10% before the long wait.
- A lawyer colluding with an heir can only shorten the waits, never skip a step.
- Outsiders can't move vault funds: only the attested agent can request signatures, and only while a will is executing.
- The developer can't read notes without shipping new agent code, which shows up as a new compose hash (with the caveat about Phala's centralized KMS below).
- Several adversarial passes, an independent audit and five review rounds are summarised in [`docs/AUDITS.md`](docs/AUDITS.md) and recorded finding by finding in `CLAUDE.md` (Decision log, including a critical sealed-note fix). Each security fix has a test.

## Sustainability: who pays, and why it lasts

- **The product:** a will people set up once and forget, priced like insurance: a small yearly fee per will (covering the agent's gas, hosting and AI), free to set up.
- **A fee on the release, not the savings:** a small percentage of each slice when it's paid out through NEAR Intents (the 1Click partner fee), so the service earns when it actually delivers, and nothing while the owner is alive.
- **Professionals:** estate lawyers and family offices manage wills for clients; the lawyer role and death-certificate path are already built for them.
- **Beyond wills:** the same engine (conditions attested by people, a challenge window, staged release) fits conditional gifts and trusts; see the roadmap.
- **Running costs today:** about $0.06 an hour for the TEE and a few NEAR a month in gas; per-will budgets stop any one will from running costs up.

## Inside the app

**Your own will** (`/account`; a side bar on desktop, a drawer from the header button on phones):

| Screen | What it's for |
|---|---|
| Home | Where the will stands, **I'm here**, will strength and the next step |
| My will | The will in plain sentences; status (Active, Paused, Completed) with **Try a speedrun** and **Pause** / **Resume**; heirs, guardians, lawyer and friends (**+ Add** by name gives an invite link with **Copy invite**); **Close will** at the bottom |
| Will in plain English | Write it in a sentence; a private NEAR AI model drafts it, code checks it and asks only for what's missing |
| Signs of life | Ranked sources (heartbeat app first); connect extra NEAR or Ethereum wallets by signing a message; the quiet period |
| Final secrets | Sealed notes per heir, released last |
| Vault | Holdings in dollars; **Deposit** (pick a chain, copy the address) and **Withdraw**; payouts to heirs |
| Activity | Messages sent, releases with explorer links, the timeline; hashes and attestation under *Technical details* |
| Try a speedrun | The same will on a clock of minutes, scenarios a–d, and **View as** each role |
| Profile | Username, linked accounts, recovery key, and your people with contact details (kept by the agent, never on-chain) |
| Sign-in | Wallet, Google or a demo account; **Restore from backup** with your recovery key |
| `/heartbeat` | An installable app: opening it is a strong sign of life |

## Real vs simulated

| Real | Not real yet |
|---|---|
| The will contract, guardians, challenge period and staged release on NEAR testnet | Social and work signals (Google, X, Instagram, TikTok, Facebook, LinkedIn): listed as *coming soon* with their weights; the control panel can send a SIMULATED one to show how weak signals are handled |
| NEAR, Sepolia ETH and testnet4 BTC payouts, signed by Chain Signatures (MPC) | DM check messages |
| The agent in an Intel TDX enclave on Phala, attested on-chain | The onward NEAR Intents swap on testnet (NEAR Intents has no testnet; priced with live quotes) |
| Signs of life: transactions from your NEAR testnet and Sepolia wallets (each added wallet is connected and signs a message proving it is yours), the signed heartbeat, Telegram replies, GitHub | |
| Email checks and alerts, sent from `mail.inheirit.xyz` to addresses you enter (*Email alerts*): your check-ins, welfare questions, guardian vote requests, the challenge alarm. Only the time is kept, never the content | |
| Sealed notes encrypted in the browser, re-sealed inside the enclave | |
| Plain-English drafting and the heir guide on an attested NEAR AI Cloud model | |
| Live NEAR Intents quotes from mainnet, public and confidential | |

## NEAR Intents on mainnet

On testnet the onward swap to each heir runs on a SIMULATED 1Click client, because NEAR Intents has no testnet. On mainnet:
- heirs see **live quotes**, public and confidential side by side, for the asset and chain they choose (`/api/quote`, dry runs);
- **real payouts** go out from a demo vault on Base, a Chain Signatures address derived from a NEAR mainnet account and signed by the MPC network, through `scripts/mainnet-payout.ts`, which a person approves one transaction at a time (caps: $5 each, $25 in total). Two are done (2026-11-12), both 1.90 USDC from the vault:
  - public, to USDC on Solana: [MPC signature](https://nearblocks.io/txns/FWPUnhyCSJrCHqzJBahCazgeLmURHGVPSsHdWtxdXcYH) · [sent on Base](https://basescan.org/tx/0xb70144f0f8ec0e99ab98c168a1925d2b69476d57aa1c2d59a1f306fe1a099c18) · [received on Solana](https://solscan.io/tx/65BJcb63tQkQnQ57Nsopv1v6cZKppy2GmnLmqiYJ2bCAsg9XYL1VuKyPyokGdzRyrw4kaDisvYvzhb8sbuRzpSaU);
  - confidential (Confidential Intents, `basic`), to USDC on Arbitrum: [MPC signature](https://nearblocks.io/txns/4RW7R4CsXYpYWaumCfT7DDCGs89Ph7faiJ797ypn8dDB) · [sent on Base](https://basescan.org/tx/0x2716595c73b267af1c03a87d737e24fdea4960274a99972af31209ca6b8f8790) · [received on Arbitrum](https://arbiscan.io/tx/0x448b42caa4165351684f87dede862c10d493aa36c5a01e50670e8e9e1d73e3d6).

  They are sends from the demo vault, not slices of a testnet will (Intents has no testnet), and both recipient addresses are the builder's own wallets. Confidential hides the link between the deposit and the receipt, not the transfers themselves. Both are listed on [`/mainnet`](https://inheirit.xyz/mainnet);
- the step-by-step, including a read-only `preflight` check, is [`docs/MAINNET.md`](docs/MAINNET.md).

**Status.** Testnet is open to everyone. Mainnet is a capped showcase: the two payouts above, approved one transaction at a time and sent to our own test addresses. The Shade Agent Framework is not yet cleared for real money and the contract hasn't had a professional audit, so mainnet stays paused until both are done.

## Honest limitations

- **Experimental stack.** The Shade Agent Framework is unaudited and testnet-only. The will runs on NEAR testnet, Sepolia and BTC testnet4.
- **Vault model.** Assets must be moved into vaults the will controls: the NEAR vault in the contract, and Sepolia/BTC addresses derived by Chain Signatures. The owner can withdraw while the will is at All good or paused.
- **Signals not connected yet:** Google Calendar, Gmail, X, Instagram, TikTok, Facebook, LinkedIn are listed as *coming soon* (the control panel can send a SIMULATED one, labelled so). Real: transactions from your NEAR testnet and Sepolia wallets (each added wallet is connected and signs a message proving it is yours), the signed heartbeat, Telegram replies, GitHub.
- **Email limits.** On the free sending tier (about 100 a day), demo-timing wills get one email per address per run from a smaller daily budget, so real-timing wills keep room; when a limit is reached, the message stays in the app with a note. Replies to these emails aren't read: the email says to open the heartbeat app or reply on Telegram.
- **Heirs are hidden in the UI only.** The app and agent don't reveal heirs before the release, but heir accounts and NEAR shares are in contract state, which anyone can read. Commit-reveal is on the roadmap.
- **Payload-blind gate.** The contract decides *when* and *which vault* can be signed, not *what* the transaction says. That rests on the attested agent code and a per-stage signature cap.
- **Centralized KMS.** With Phala's KMS, whoever controls the Phala account could push new agent code that derives the same sealed-notes key. Every deployed compose hash is published (`deploy/tee-agent.json`) and must be approved on the contract to register. An on-chain KMS with a timelocked allowlist is on the roadmap.
- **Key persistence.** The sealed-notes key is tied to one Phala app; the agent is upgraded in place and never re-created. Losing that app means owners must re-seal their notes.
- **Not built yet:**
  - `not_before` conditions are parsed and shown today; enforcement is next;
  - a quiet period that keeps adapting: it is suggested from your history at setup, then stays the number you confirmed.
- **Expired guardian votes restart the ladder.** If guardians don't vote, the will returns to All good without a new sign of life, so the ladder starts again at once (about every 7 minutes on demo timings). The repeated checks and welfare messages appear in the app, but Telegram sends each of them only once per silence. The challenge alarm is always sent.
- **NEAR Intents is SIMULATED on testnet.** NEAR Intents has no testnet. The testnet slices are real transfers; the swap that takes them on to the heir's choice runs on a simulated 1Click client (live prices, fake deposit address). On mainnet: heirs see live dry quotes, and real payouts were sent from our demo vault (see above) only by a local script (`scripts/mainnet-payout.ts`) that asks a person for approval before every transaction (caps: $5 each, $25 in total). Any made are listed at `/mainnet`. In production, the attested agent's mainnet contract would sign these legs.
- **Payout waiting happens after the vault.** If an heir hasn't chosen how to be paid, their onward payout waits and later slices are paid together. The testnet slice itself still leaves the vault on schedule. Holding it in the vault would need a contract change (roadmap).
- **One will and one vault per account.** Several vaults with their own rules are on the roadmap.
- **Contact details stay off-chain.** People's email, Telegram and wallets are saved with the agent, owner-signed, inside the enclave; a person on the will can't be deleted from Profile until they're removed from the will.
- **Closing a will.** The contract can't see other chains; the app checks the Sepolia and Bitcoin vaults (through the agent) before it offers *Close will*.
- **Extra signal sources are private.** The agent never reveals the extra NEAR accounts or Sepolia addresses you added, so they can be removed only from the device you added them on.
- **Names are local.** Usernames and the generated people's names live in your browser; the testnet account id stays the on-chain identity, and other browsers see the account id.
- **Browser-held keys.** Demo and Google accounts keep their key in the browser that made them, so a Google account works in that browser only, and a lost browser means a lost testnet account. Wallet users keep their keys in their wallet.
- **Speedruns expire.** On the hosted demo, the agent stops watching a will on demo timings a few hours after it started (never mid-release, in the guardian vote or in the challenge period). Wills on real timings are watched indefinitely.
- **Start over clears the old record.** Replacing a Completed will keeps released notes and leftover NEAR, but drops the old will's execution records, so onward payouts still waiting for an heir's choice from that run are dropped too.

## Roadmap

- **Several vaults with their own rules (conditional gifts).** One account, several vaults, each with its own people, conditions and schedule.
- **Beyond wills: conditional releases.** The will is the first product of a conditional-release engine: conditions attested by people, a challenge window, and staged release. The same pieces fit gifts on a milestone (a graduation, a first home), timed gifts (a birthday, a date), and payouts for competitions and bounties, where judges attest the winner instead of guardians attesting a death. The `not_before` condition is the first example: parsed and shown today; enforcement is next.
- A human adjudicator for disputes and heir support.
- Real wallet and email linking for Google Calendar, Gmail, X, Instagram and LinkedIn, with OAuth tokens kept in the TEE.
- A quiet period that adapts over time, per source.
- Incapacity mode: a capped caretaker allowance via function-call keys.
- Fire-drill mode, and stale-will review.
- A lawyer companion letter.
- Gasless heir claims.
- Real-world contacts: guardians, friends and lawyers reached by phone number instead of a link, and bank or Cash App payouts for heirs without crypto.
- **Private inheritance with Confidential Intents:** payouts that observers can't trace from the will's release to the heir's receipt. A confidential payout has already gone through on mainnet (above); heirs see confidential quotes next to public ones.
- **Intents-native vault:** the will holds every asset as a NEAR Intents balance, distributes by internal transfer, and heirs withdraw to any chain. One vault for every asset, and instant cross-chain payout. A dry 1Click quote from an Intents balance to USDC on Base already succeeds.
- Self-funding upkeep: the agent pays its own inference and hosting via Intents, and tops up gas for vaults and heirs.
- Contract-level heir hiding (commit-reveal).
- An on-chain KMS with a timelocked compose allowlist.

## Run it yourself

The quickest way: run the web app against the hosted backend (the attested agent and `inheirit.testnet`), which is what `web/.env.example` points at.

```bash
npm ci --ignore-scripts                 # repo root (the web app imports the shared policy code)
cd web && npm ci && cp .env.example .env.local && npm run dev -- -p 3100   # web on :3100
```

Sign-in and live quotes also need the server-side variables listed in `web/.env.example` (a testnet account to fund sign-ups, and the 1Click key); without them those parts say they aren't available.

The agent and its tests:

```bash
npm ci                                  # repo root
npm test                                # agent tests (266)
cp .env.example .env                    # AGENT_CONTRACT_ID, SPONSOR_*, NEARAI_API_KEY, DEMO_MODE=true (TELEGRAM_* optional)
npm run dev                             # agent on :3000
```

A local agent can't register on `inheirit.testnet`, which accepts only the attested TEE agent. Give it its own local-mode contract (`npx tsx scripts/deploy-dev-contract.ts <your agent's account id>` creates it and whitelists that agent) and point both `.env` files at it.

Contract: `cd agent-contract && cargo +1.86.0 test --lib` (196 unit tests). The sandbox tests (`cargo +1.86.0 test --tests`) need the wasm at `target/near/shade_contract_template.wasm` first: `cargo +1.86.0 near build non-reproducible-wasm --no-abi` (or the pinned `sourcescan/cargo-near` Docker image).

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
