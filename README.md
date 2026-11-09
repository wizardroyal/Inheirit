# Inheirit — a will that doesn't make you prove you're alive

Built at **NEAR HACKATHON** (November 2026). The will runs on NEAR testnet and touches no real money. NEAR Intents has no testnet, so its payouts are SIMULATED in the app; a small, optional mainnet demo runs only from a local script that asks for approval before every transaction.

Inheirit reads normal signs of life privately and only reaches out when you've gone quiet for longer than usual. It **never acts on silence alone**. If people confirm you're gone and you stay silent through a challenge period, it hands over your assets across **NEAR, Ethereum and Bitcoin** in small, reversible slices. Sealed instructions for everything else are revealed to the right heir **last**.

**Try it:** https://inheirit.vercel.app/demo · Agent (TEE): https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network · Contract: [`inheirit.testnet`](https://testnet.nearblocks.io/address/inheirit.testnet)

## Four ideas the design rests on

1. **Passive liveness is safe only because of an asymmetry.** Signals can stop the will. Only people can start it: a quorum of guardians who accepted the role, then a challenge period.
2. **The first release is the loudest alarm.** A 10% slice leaving your vaults, with heirs notified, is when a living owner notices. So the *longest wait* comes right after the first slice, and a false trigger costs at most that slice.
3. **Secrets come last.** Funds move in slices, but a revealed secret can never be un-revealed. Sealed notes are released only after distribution completes, plus a buffer.
4. **Private by construction.** The agent reads signals inside a TEE and only timestamps leave it. In-product AI uses only an attested NEAR AI Cloud model.

**Your heirs receive what they actually use.** Each heir chooses the asset and chain they're paid in (USDC on Base, SOL on Solana, NEAR…), and every released slice goes on to them through **NEAR Intents**. Owners can choose **stable value**, so each slice is converted to US dollars as it's released and heirs aren't exposed to price swings during a release that takes months. And a will can be **funded from anywhere**, from whatever token and chain the owner holds.

Inactivity-based tools exist, such as Google Inactive Account Manager and Bitcoin timelock wallets. What's new is the combination: many weighted sources read privately in a TEE, a human escalation ladder before anything moves, staged cross-chain execution, and secrets last.

## The problem

Billions in crypto are lost when holders die or become incapacitated. Earlier attempts mostly solved the *transfer* and failed on the *humans*:

| Problem | Why past attempts failed | What Inheirit does |
|---|---|---|
| Check-in fatigue | Dead-man's switches make you prove you're alive every month. People forget. | No check-ins. The agent watches activity you already produce, and asks (heartbeat app, Telegram) only when you've gone quiet. |
| False triggers | A hospital stay, a retreat or a lost phone looks like death to a timer. | Silence alone can never execute. It takes a guardian quorum, then a challenge period that any sign of life cancels. |
| Single chain | Bitcoin-only timelocks, EVM-only contracts. | One will across NEAR, Ethereum (Sepolia) and Bitcoin (testnet4) via NEAR Chain Signatures. |
| Heirs can't claim | Heirs don't know assets exist, or don't have the right wallet for the right chain. | A guided claim page, an AI guide that sees only the heir's own claim details, and payouts in whatever asset and chain the heir already uses (NEAR Intents). |
| Secrets in a public will | A seed phrase can't go into a will that becomes public. | Sealed notes, encrypted in the browser to a TEE key and re-sealed to the heir only after distribution completes. |
| No undo | Once triggered, everything moves at once. | 10% → 20% → 30% → 40%, the longest wait after the first slice. Any sign of life halts the rest, and the secrets. |

## Try it in 5 minutes (no wallet, no money)

Open **https://inheirit.vercel.app/demo**. The clock is compressed: a will goes quiet after 2 minutes instead of weeks.

**Scenario A: silence doesn't kill you**
1. Click **Create a demo cast**. In about 20 s you get throwaway testnet accounts, created in your browser from the public testnet faucet: Alice (owner), Bola (heir), three guardians and a friend.
2. Click **Create the demo will**. The guardians accept their role, which **arms** the will; a will whose guardians haven't accepted never escalates. Alice's will appears at **All good** in the *Signs of life* panel, with 1 NEAR in the NEAR vault. The demo faucet also funds the Sepolia and BTC vaults, which are addresses derived by Chain Signatures.
3. Do nothing. After about 2 min the ladder climbs to **Quiet**, and the checks are logged (heartbeat app, email, Telegram, DM). Then **Welfare check**, then **Guardian vote** (about 5 min in total). Each step has a countdown, and the plain-English verdict says what is happening and why.
4. Click **Confirm passing** for two guardians. The will enters the **Challenge period**, and Alice is told on every channel.
5. Click **X post** (SIMULATED). Nothing happens, on purpose. The verdict explains: *"One X post seen; ignored on its own because posts can be scheduled or run by someone else."*
6. Click **Heartbeat (real, signed by Alice)**. Within about 15 s the ladder **snaps back to All good**. Nothing was released.

**Scenario B: it actually executes**
1. Make a new cast and will (tick **Stable value** to see slices paid in USDC), then open the **heir** link → choose Bola → **Create and register my key**. Under **How you'd like to receive it**, pick e.g. **USDC on Base** or **SOL on Solana** and an address, then **Save** (signed by Bola; checked against NEAR Intents first).
2. Repeat steps 3–4 and don't send a sign of life. After the challenge period (2 min) the will is **Releasing in stages**: 10% lands on NEAR, Sepolia and BTC testnet4, with explorer links in *Released so far*.
3. The next slice waits **3 min**, the longest wait. Then 20%, 30% and 40% follow a minute apart. **Onward payouts (NEAR Intents)** shows each slice going on to Bola's choice: quote, deposit, swap, arrived (SIMULATED on testnet, priced live from 1Click). Slices under $1 are combined with the next one. If Bola hasn't chosen yet, the panel says the inheritance is waiting for Bola.
4. After the last slice comes a 1-minute **secrets buffer**, then **Secrets released**. On the heir page, **Decrypt here** shows *"The Ledger is in the blue folder in the study…"*. That note was sealed in Alice's browser and only Bola's key opens it. Ask the guide a question if you like.
5. To see the halt instead: during any stage, click **Alice: "I'm alive" on-chain**. The remaining stages and the secrets halt, and the partial release is recorded.

**Your own will** (`/owner`): **Quick setup (3 steps)** asks for your display name, your signals, your people (heirs, guardians, optional lawyer and friends) and your vault. It shows a live "who gets what" preview and "if you go quiet: earliest move ≈ 6 min, full distribution ≈ 11 min, secrets ≈ 13 min". You can also write the will in plain English. Afterwards, a **will-strength checklist** shows what arms the will and what makes it stronger, including **Link Telegram**: if you go quiet, the bot checks in, and any reply cancels. Guardians accept at `/guardian/<owner>`, and `/heartbeat` is an installable app.

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
        └──▶ Telegram bot (check messages; replies count as signs of life)
```

**The ladder:**
1. **All good** (armed only once guardians accept).
2. **Quiet:** checks go out to the heartbeat app, email, Telegram, then DMs.
3. **Welfare check:** guardians, friends and the lawyer are asked.
4. **Guardian vote.**
5. **Challenge:** the owner is told everywhere.
6. **Releasing:** 10% → *longest wait* → 20% → 30% → 40%.
7. **Secrets buffer.**
8. **Secrets released.**
9. **Completed.**

**Signals vs checks.**
- A strong signal (a signed NEAR or Sepolia transaction, a heartbeat) or a medium one (a Telegram reply) counts on its own.
- A weak signal (a social post, GitHub) counts only if a second, different source agrees within 24 h.
- Any counted sign of life sends the will back to the top, even mid-execution or during the secrets buffer.

**Acceleration.** A lawyer, or the guardian quorum with evidence, can attest a death certificate. That switches the remaining stages to a faster schedule (10/30/60, shorter waits). It never skips the guardian vote, the challenge period or a stage.

## NEAR technology used, and where

| Tech | Used for | Code |
|---|---|---|
| NEAR smart contract (Rust, near-sdk 5) | Will state machine (stage waits, secrets buffer, guardian consent, lawyer acceleration), NEAR vault, signing gate, sealed-note storage, NEP-297 events | `agent-contract/src/will/` (157 unit tests, sandbox tests in `agent-contract/tests/will_flow_tests.rs`) |
| **Chain Signatures** (`v1.signer-prod.testnet`) | Vault addresses on Sepolia and BTC testnet4, derived from the contract account (`heirloom/<owner>/eth\|btc`); release and withdrawal signatures | gate: `agent-contract/src/will/agent.rs`; tx building: `src/chains/evm.ts`, `src/chains/btc.ts` (chainsig.js) |
| **Shade Agent Framework** (TEE on Phala) | The will agent: liveness scoring and verdict, escalation and checks, execution, sealed-note crypto, Telegram bot. Registered with a real TDX attestation; measurements approved on-chain. | `src/index.ts`, `src/escalation/`, `src/liveness/`, `src/executor/`, `src/sealed/`, `src/telegram/`, `scripts/tee-agent.ts` |
| **NEAR AI Cloud** (private inference) | Plain-English will → structured policy; heir claim guide. Will text goes only to a model whose attestation passes (TDX quote, NVIDIA GPU, signer bound to a fresh nonce; checked at startup and before each use), and every answer's signature must recover to the attested signer. | `src/ai/attestation.ts`, `src/ai/nearai.ts`, `src/ai/policy-parser.ts`, `src/ai/heir-guide.ts` |
| **NEAR Intents** (1Click API) | Universal payout: each released slice goes on to the heir's chosen asset and chain; stable-value mode (USDC); fund from anywhere. On testnet the agent uses a SIMULATED 1Click client with live prices; real mainnet payouts from a Chain Signatures-derived Base vault via an approval-gated script | `src/intents/oneclick.ts`, `src/intents/payout.ts`, `web/src/components/Payouts.tsx`, `scripts/mainnet-payout.ts` |
| NEP-413 signed messages | Owner-signed requests to the agent (heartbeat, watch settings, Telegram link, drafting, guide, demo faucet), and heir-signed payout choices, checked against the account's on-chain keys | `src/auth/nep413.ts`, `web/src/lib/near.ts` |
| Named accounts | Readable owners, heirs, guardians and lawyers | throughout |

## Privacy

- **What runs in the TEE:** the agent. It polls signal sources, scores liveness, signs releases, runs the Telegram bot, and holds the sealed-notes private key. That key is derived from Phala's KMS for this app (`getKey`) and kept only in memory.
- **What leaves it:** timestamps (`record_liveness`), state transitions, signed transfers, and notes re-sealed to an heir's key. Signal adapters return the time of the latest activity, never content. A Telegram reply is recorded as its receive time only; its text is never stored or logged.
- **Sealed notes:** encrypted in the owner's browser (libsodium sealed box) to the agent's key; only ciphertext goes on-chain. Once the will reaches *Secrets released*, the agent opens each note inside the TEE and re-seals it to the heir's X25519 key, and the heir decrypts it in their browser.
- **Will text** is processed only by an attested NEAR AI Cloud model. We verified that only 12 of 61 listed models attest; proxied models are refused.
- **Minimal data:** sign-up asks for a display name and, optionally, a jurisdiction. Nothing else: no date of birth, nationality or photo.
- **In the UI:** the *Signs of life* panel says "What the agent saw: timestamps only", next to badges for the attested TEE agent (approved compose hashes, registered agent, sealed-notes key match) and for the NEAR AI model (each check of a fresh attestation).

## Threat model

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). In short:
- A greedy heir needs colluding *accepted* guardians *and* the owner's silence through a loud challenge period. Even then, a false trigger costs at most the first 10% before the long wait.
- A lawyer colluding with an heir can only shorten the waits, never skip a step.
- Outsiders can't move vault funds: only the attested agent can request signatures, and only while a will is executing.
- The developer can't read notes without shipping new agent code, which shows up as a new compose hash (with the caveat about Phala's centralized KMS below).

## Honest limitations

- **Experimental stack.** The Shade Agent Framework is unaudited and testnet-only. Everything here runs on NEAR testnet, Sepolia and BTC testnet4.
- **Vault model.** Assets must be moved into vaults the will controls: the NEAR vault in the contract, and Sepolia/BTC addresses derived by Chain Signatures. The owner can withdraw while the will is Active.
- **Simulated signals**, labelled SIMULATED in the UI: Google Calendar, Gmail, X, Instagram, TikTok, Facebook, WhatsApp, LinkedIn. Real: NEAR transactions, Sepolia transactions, the signed heartbeat, Telegram replies, GitHub.
- **Email** checks are shown in the app; no email is sent yet.
- **Heirs are hidden in the UI only.** The app and agent don't reveal heirs before execution, but heir accounts and NEAR shares are in contract state, which anyone can read. Commit-reveal is on the roadmap.
- **Payload-blind gate.** The contract decides *when* and *which vault* can be signed, not *what* the transaction says. That rests on the attested agent code and a per-stage signature cap.
- **Centralized KMS.** With Phala's KMS, whoever controls the Phala account could push new agent code that derives the same sealed-notes key. Every deployed compose hash is published (`deploy/tee-agent.json`) and must be approved on the contract to register. An on-chain KMS with a timelocked allowlist is on the roadmap.
- **Key persistence.** The sealed-notes key is tied to one Phala app; the agent is upgraded in place and never re-created. Losing that app means owners must re-seal their notes.
- **Not built yet:**
  - enforcing policy `conditions` (e.g. "not before 2031"), which are parsed and shown;
  - an adaptive "your normal" baseline: the quiet threshold is a fixed setting per will.
- **Expired guardian votes restart the ladder.** If guardians don't vote, the will returns to Active without a new sign of life, so the ladder starts again at once (about every 7 minutes in the demo timings). The repeat checks and welfare messages appear in the app, but Telegram sends each of them only once per silence. The challenge alarm is always sent.
- **NEAR Intents is SIMULATED on testnet.** NEAR Intents has no testnet. The testnet slices are real transfers; their onward swap to the heir's choice runs on a simulated 1Click client (live prices, fake deposit address). Payout and funding through Intents are demonstrated on mainnet with small real amounts from a demo vault, signed by a local script (`scripts/mainnet-payout.ts`) that asks for approval before every transaction. In production, the attested agent's mainnet contract would sign these legs. Records of real mainnet payouts appear in the app under "On mainnet".
- **Payout waiting happens after the vault.** If an heir hasn't chosen how to receive, their onward payout waits and later slices are paid out together. The testnet slice itself still leaves the vault on schedule. Holding it in the vault would need a contract change (roadmap).
- **Browser-held demo keys.** The demo creates testnet accounts whose keys live in your browser's storage. Wallet connection is on the roadmap.

## Roadmap

- A human adjudicator for disputes and heir support.
- Real Gmail, Calendar, X, Instagram, WhatsApp and LinkedIn adapters, with OAuth tokens kept in the TEE.
- An adaptive baseline per source.
- Incapacity mode: a capped caretaker allowance via function-call keys.
- Fire-drill mode, and stale-will review.
- A lawyer companion letter.
- Gasless heir claims.
- **Private inheritance with Confidential Intents:** payouts that observers can't trace from the will's release to the heir's receipt. A confidential quote already works with our key; the UI is gated until the public payouts are proven on mainnet.
- **Intents-native vault:** the will holds every asset as a NEAR Intents balance, distributes by internal transfer, and heirs withdraw to any chain. One vault for every asset, and instant cross-chain payout. A dry 1Click quote from an Intents balance to USDC on Base already succeeds.
- Self-funding upkeep: the agent pays its own inference and hosting via Intents, and tops up gas for vaults and heirs.
- Contract-level heir hiding (commit-reveal).
- An on-chain KMS with a timelocked compose allowlist.

## Run it yourself

```bash
npm ci                                  # agent (repo root)
cp .env.example .env                    # AGENT_CONTRACT_ID, SPONSOR_*, NEARAI_API_KEY, DEMO_MODE=true (TELEGRAM_* optional)
npm test                                # agent tests (206)
npm run dev                             # agent on :3000
cd web && npm ci && cp .env.example .env.local && npm run dev -- -p 3100   # web on :3100
```

Contract: `cd agent-contract && cargo +1.86.0 test --lib` (157 unit tests). The sandbox tests (`cargo +1.86.0 test --tests`) need the wasm at `target/near/shade_contract_template.wasm` first: `cargo +1.86.0 near build non-reproducible-wasm --no-abi` (or the pinned `sourcescan/cargo-near` Docker image).

Headless scenario scripts:
- `scripts/demo-cancel.ts`: Scenario A.
- `scripts/demo-execute.ts`: Scenario B on three chains.
- `scripts/demo-sealed-note.ts`: English will → sealed note → heir decrypts, secrets last.
- `scripts/demo-accelerate.ts`: lawyer death proof → accelerated schedule; the challenge period is kept.
- `scripts/demo-telegram.ts`: an unarmed will stays Active; a Telegram reply cancels Quiet.
- `scripts/demo-payout.ts`: Scenario B with NEAR Intents payouts (SIMULATED): two heirs, stable value, one heir choosing late.
- `scripts/mainnet-payout.ts`: the **mainnet** NEAR Intents demo (vault address, dry quotes, approval-gated payouts and funding; caps $5 per transaction, $25 in total).

Helpers: `scripts/fund-vaults.ts`, `scripts/new-funder.ts`. Deploying: [`docs/DEPLOY.md`](docs/DEPLOY.md). The project brief and every decision with its evidence: [`CLAUDE.md`](CLAUDE.md).

## Credits

- Built on the [Shade Agent template](https://github.com/NearDeFi/shade-agent-template) by NEAR (Apache-2.0); see `LICENSE`, `NOTICE.txt`, `LICENSE-THIRD-PARTY.txt`.
- NEAR AI attestation checks adapted from [nearai/nearai-cloud-verifier](https://github.com/nearai/nearai-cloud-verifier) (MIT, `src/ai/LICENSE-nearai-cloud-verifier`).
- Built with Claude Code.
