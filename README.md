# Inheirit — a crypto will that doesn't make you prove you're alive

Built at **NEAR HACKATHON** (November 2026). Testnet only: nothing here touches real money.

Inheirit watches for normal signs of life privately, only escalates when you go quiet, **never triggers on silence alone**, and releases assets **in stages** across **NEAR, Ethereum and Bitcoin**. It also holds sealed instructions for everything else, which are decrypted only for the right heir, and only after execution has started.

**Try it:** `<WEB_URL — set at deploy>` · Agent (TEE): https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network · Contract: [`inheirit.testnet`](https://testnet.nearblocks.io/address/inheirit.testnet)

## The problem

Billions in crypto are lost when holders die or become incapacitated. Earlier attempts mostly solved the *transfer* and failed on the *humans*:

| Problem | Why past attempts failed | What Inheirit does |
|---|---|---|
| Check-in fatigue | Dead-man's switches make you prove you're alive every month. People forget. | No check-ins. The agent watches activity you already produce. |
| False triggers | A hospital stay, a retreat or a lost phone looks like death to a timer. | Silence alone can never execute. It takes a guardian quorum, then a challenge period that any sign of life cancels. |
| Single chain | Bitcoin-only timelocks, EVM-only contracts. | One will across NEAR, Ethereum (Sepolia) and Bitcoin (testnet4) via NEAR Chain Signatures. |
| Heirs can't claim | Heirs don't know assets exist or can't operate a wallet. | A guided claim page, plus an AI guide that sees only the heir's own claim details. |
| Secrets in a public will | A seed phrase can't go into a will that becomes public. | Sealed notes: encrypted in the browser to a TEE key, re-sealed only to the heir's key after execution starts. |
| No undo | Once triggered, everything moves at once. | Staged release (10% → 30% → 60%). Any sign of life between stages halts the rest. |

## Try it in 5 minutes (no wallet, no money)

Open **`<WEB_URL>/demo`**. The demo clock is compressed: a will goes quiet after 2 minutes instead of weeks.

**Scenario A: silence doesn't kill you**
1. Click **Create a demo cast** → in about 20 s you get throwaway testnet accounts for Alice (owner), Bola (heir), three guardians and a friend, created in your browser from the public testnet faucet.
2. Click **Create the demo will** → Alice's will appears on the ladder at **All good**, with 1 NEAR in the NEAR vault. The demo faucet also funds the Sepolia and BTC vaults, which are addresses derived by Chain Signatures.
3. Do nothing. → After about 2 min the will goes **Quiet**, then **Welfare check**, then **Guardian vote** (~5 min total). The **Notifications** card shows who the agent contacted at each step.
4. Click **Confirm passing** for two guardians → **Challenge period**. Alice is told on every channel.
5. Click **X post** (SIMULATED) → nothing happens, on purpose: one weak signal never counts, because posts can be scheduled or run by someone else.
6. Click **Heartbeat (real, signed by Alice)** → within ~15 s the will is back to **All good**. Nothing was released.

**Scenario B: it actually executes**
1. Repeat steps 1–4 with a new cast, and don't send a sign of life.
2. After the challenge period (2 min) the will is **Releasing in stages**. In **Released so far**, stage 1 (10%) lands on NEAR, Sepolia and BTC testnet4, with explorer links. The BTC signature takes about a minute.
3. Open the **heir** link → choose Bola → **Create and register my key**. Once released, **Decrypt here** shows *"The Ledger is in the blue folder in the study…"*. That note was sealed in Alice's browser and is readable only with Bola's key. Ask the guide a question if you like.
4. Back on the demo panel, click **Alice: "I'm alive" on-chain** mid-execution → the remaining stages halt and the halt is recorded; 90% stays in the vault.

Scenario B step 3 works best if you register Bola's key before execution starts (any time after step 2 of Scenario A). The same flows are on `/owner` (write a will in plain English), `/guardian/<owner>`, `/heir/<owner>` and `/heartbeat` (installable).

## How it works

```
 signs of life (NEAR txs · Sepolia txs · heartbeat app · GitHub · SIMULATED: calendar, mail, X, Instagram)
        │  timestamps only
        ▼
 ┌──────────────────────────────┐ record_liveness / advance ┌──────────────────────────────┐
 │ Will agent (Shade Agent,     │──────────────────────────▶│ inheirit.testnet (Rust)      │
 │ Intel TDX on Phala)          │                           │ will state machine, guardians│
 │ scoring · escalation ·       │◀── gated request_signature│ NEAR vault, signing gate     │
 │ executor · sealed notes      │                           └───────────┬──────────────────┘
 └──────┬───────────────┬───────┘                                       │ sign (only when Executing,
        │               │ NEAR AI Cloud (attested TEE model)            ▼  or an owner withdrawal)
        │               └─ plain-English will → policy; heir guide   MPC signer v1.signer-prod.testnet
        └──▶ Sepolia · BTC testnet4 (signed vault transfers)
```

**The ladder:** All good → Quiet (owner nudged) → Welfare check (contacts asked) → Guardian vote → Challenge (owner told everywhere) → Releasing in stages → Completed.

**Two rules:** *signals can stop it; only people can start it.* Any sign of life from a strong source (signed NEAR or Sepolia transaction, signed heartbeat), or from two weak sources agreeing within 24 h, sends the will back to the top, even mid-execution. Going down the ladder needs time to pass **and** a guardian quorum.

## NEAR technology used, and where

| Tech | Used for | Code |
|---|---|---|
| NEAR smart contract (Rust, near-sdk 5) | Will state machine, guardians, NEAR vault, signing gate, sealed-note storage, NEP-297 events | `agent-contract/src/will/` (68 unit tests in `tests.rs`, sandbox tests in `agent-contract/tests/will_flow_tests.rs`) |
| **Chain Signatures** (`v1.signer-prod.testnet`) | Vault addresses on Sepolia and BTC testnet4 derived from the contract account (`heirloom/<owner>/eth\|btc`); release and withdrawal signatures | gate: `agent-contract/src/will/agent.rs`; tx building: `src/chains/evm.ts`, `src/chains/btc.ts` (chainsig.js) |
| **Shade Agent Framework** (TEE on Phala) | The will agent: liveness, escalation, execution, sealed-note crypto. Registered with a real TDX attestation; measurements approved on-chain. | `src/index.ts`, `src/escalation/`, `src/executor/`, `src/sealed/`, `scripts/tee-agent.ts` |
| **NEAR AI Cloud** (private inference) | Plain-English will → structured policy; heir claim guide. Will text goes only to a model whose attestation passes (TDX quote, NVIDIA GPU, signer bound to a fresh nonce), and every answer's signature must recover to the attested signer. | `src/ai/attestation.ts`, `src/ai/nearai.ts`, `src/ai/policy-parser.ts`, `src/ai/heir-guide.ts` |
| NEP-413 signed messages | Owner-signed requests to the agent (heartbeat, watch settings, drafting, guide, demo faucet), checked against the account's on-chain keys | `src/auth/nep413.ts`, `web/src/lib/near.ts` |
| Named accounts | Readable owners, heirs and guardians | throughout |

## Privacy

- **What runs in the TEE:** the agent. It polls signal sources, scores liveness, signs releases, and holds the sealed-notes private key. That key is derived from Phala's KMS for this app (`getKey`) and kept only in memory.
- **What leaves it:** timestamps (`record_liveness`), state transitions, signed transfers, and notes re-sealed to an heir's key. Signal adapters return the time of the latest activity, never content.
- **Sealed notes:** encrypted in the owner's browser (libsodium sealed box) to the agent's key; only ciphertext goes on-chain. After execution starts, the agent opens each note inside the TEE and re-seals it to the heir's X25519 key, and the heir decrypts it in their browser.
- **Will text** is processed only by an attested NEAR AI Cloud model (we verified that only 12 of 61 listed models attest; proxied models are refused).
- **Attestation in the UI:** the *Trust* card shows the contract's `requires_tee`, the approved compose hashes, the registered agent, and whether the agent's sealed-notes key matches the contract. The AI badge shows each check of a fresh NEAR AI attestation.

## Threat model

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). In short: a greedy heir needs colluding guardians *and* the owner's silence through a loud challenge period; outsiders can't move vault funds because only the attested agent can request signatures, and only while a will is executing; the developer can't read notes without shipping new agent code, which shows up as a new compose hash (with the caveat about Phala's centralized KMS below).

## Honest limitations

- **Experimental stack.** The Shade Agent Framework is unaudited and testnet-only. Everything here runs on NEAR testnet, Sepolia and BTC testnet4.
- **Vault model.** Assets must be moved into vaults the will controls (the NEAR vault in the contract; Sepolia/BTC addresses derived by Chain Signatures). The owner can withdraw while the will is Active.
- **Simulated signals**, labelled SIMULATED in the UI: Google Calendar, Gmail, X, Instagram. Real: NEAR transactions, Sepolia transactions, the signed heartbeat, GitHub.
- **Payload-blind gate.** The contract decides *when* and *which vault* can be signed, not *what* the transaction says; that rests on the attested agent code and a per-stage signature cap.
- **Centralized KMS.** With Phala's KMS, whoever controls the Phala account could push new agent code that derives the same sealed-notes key. Every deployed compose hash is published (`deploy/tee-agent.json`) and must be approved on the contract to register. An on-chain KMS with a timelocked allowlist is on the roadmap.
- **Key persistence.** The sealed-notes key is tied to one Phala app; the agent is upgraded in place and never re-created. Losing that app means owners must re-seal their notes.
- **Not enforced yet:** policy `conditions` (e.g. "not before 2031") are parsed and shown, not enforced. The quiet threshold is fixed per will; the adaptive baseline is on the roadmap.
- **Browser-held demo keys.** The demo creates testnet accounts whose keys live in your browser's storage. Wallet connection is on the roadmap.

## Roadmap

Guardian liveness override for hijacked accounts · fire-drill mode · incapacity mode (capped caretaker allowance) · stale-will review · real Google Calendar/Gmail adapters (OAuth, tokens in the TEE) · ERC-20 vaults · enforcing `conditions` · gasless heir claims · NEAR Wallet Selector · on-chain KMS with a timelocked compose allowlist.

## Run it yourself

```bash
npm ci                                  # agent (repo root)
cp .env.example .env                    # AGENT_CONTRACT_ID, SPONSOR_*, NEARAI_API_KEY, DEMO_MODE=true
npm test                                # agent tests
npm run dev                             # agent on :3000
cd web && npm ci && cp .env.example .env.local && npm run dev -- -p 3100   # web on :3100
```

Contract: `cd agent-contract && cargo +1.86.0 test --lib`. Headless scenario scripts: `scripts/demo-execute.ts` (Scenario B), `scripts/demo-sealed-note.ts` (English will → sealed note → heir decrypts), `scripts/fund-vaults.ts`. Project brief and every decision with its evidence: [`CLAUDE.md`](CLAUDE.md).

## Credits

- Built on the [Shade Agent template](https://github.com/NearDeFi/shade-agent-template) by NEAR (Apache-2.0); see `LICENSE`, `NOTICE.txt`, `LICENSE-THIRD-PARTY.txt`.
- NEAR AI attestation checks adapted from [nearai/nearai-cloud-verifier](https://github.com/nearai/nearai-cloud-verifier) (MIT, `src/ai/LICENSE-nearai-cloud-verifier`).
- Built with Claude Code.
