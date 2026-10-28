# CLAUDE.md — Heirloom (working name): a cross-chain crypto will on NEAR

> **Read this whole file before doing anything.** It is the single source of truth for this project: what we're building, why, how, in what order, and what has been decided. Update the **Status** and **Decision log** sections at the end of every working session. If something in the code disagrees with this file, stop and ask the human which one is right.

---

## 0. Who you are working with and how

- The human is a solo builder entering **NEAR HACKATHON** (Nov 1–14, 2026). They build with you (Claude Code) all day. They are technical but new to hackathons and to parts of the NEAR stack.
- Your job: implement, test, and document this project to a **competent working level in 5 build days** (originally Nov 1–5; can start any time), then harden and polish through Nov 14.
- **Working style:**
  - Diagnose before fixing. When something breaks, explain the cause before changing code.
  - Tests first for the smart contract. The contract holds money; its bugs are the expensive ones.
  - Small, verifiable steps. After each step, tell the human exactly how to verify it ("run X, expect Y").
  - Commit at every ✅ checkpoint in §12 with a clear message. Never force-push.
  - When docs and this file disagree on an external API (contract IDs, SDK methods), **the official docs win**. Note the discrepancy in the Decision log.
  - Items marked **[VERIFY]** are things we believe but have not confirmed. Confirm them against current docs before building on them.

### Hard rules (never break these without the human's explicit yes in chat)
1. **Testnet only.** Never deploy to mainnet, never sign mainnet transactions, never spend real funds.
2. **No secrets in the repo.** Keys, seed phrases, API keys live in `.env` files that are git-ignored. Provide `.env.example` with placeholder names only.
3. **Never push, make the repo public, or deploy to Phala Cloud** without asking first.
4. **Never post anything** (X, Discord, etc.) on the human's behalf.
5. **Never submit the hackathon form.** `HACKATHON.md` describes a submission API; only the human decides when and what to submit.

---

## 1. The hackathon (context that shapes decisions)

### 1.1 Facts
- Event: NEAR HACKATHON — https://nearhackathon.com — rules for agents: https://nearhackathon.com/HACKATHON.md (copy kept in repo root; re-read before submission, it may change).
- Submission window: **2026-11-01T00:00Z → 2026-11-14T23:59Z**. Judging Nov 16–18. Development can start any time (organizers, NearBuilders chat, 2026-10-27).
- Submission needs: **public GitHub repo** + **public demo post on X** (video or screenshots, says it was built at NEAR HACKATHON). One submission per team, cannot be edited.
- Prize: $55K grand prize; $10K/$3K/$2K for 1st/2nd/3rd in each of 13 tracks. A project can be entered in several tracks.
- **Target tracks:** `realworld` (Real-World Money), `security` (AI Security & Defense), `privacy` (Privacy & Private AI). Possibly `open`.
- **Judges** include NEAR's Illia Polosukhin, crypto investors (a16z crypto, Dragonfly, Electric Capital, cyber•Fund, Helius, Synthetix/Infinex) **and Claude Code + Codex as AI judges**. Past criteria: technical implementation, design, impact, originality, sustainability.

### 1.2 Submission rules
- Submit between **2026-11-01T00:00Z and 2026-11-14T23:59Z**.
- The repo must be **public by 2026-11-14T23:59Z**.
- **One submission per team.**

### 1.3 What the AI judges will do
They will read the README and the code. So:
- README must explain what it is, the problem, and give **"do X → see Y"** steps a judge can follow on testnet without spending money.
- Code should be clean, typed, tested, and honest. **Anything simulated is labelled SIMULATED** in code, UI and README.
- Name the NEAR technologies used and where each lives in the code.

---

## 2. The product

### 2.1 One-liner
**A crypto will that doesn't make you prove you're alive.** It watches for normal signs of life privately, only escalates when you go quiet, never triggers on silence alone, and releases assets in stages across NEAR, Ethereum and Bitcoin, plus sealed instructions for everything else, decrypted only for the right heir, only after execution.

### 2.2 The problem (from research on past attempts)
Billions in crypto are lost when holders die or become incapacitated. Past attempts (dead-man's-switch contracts, Bitcoin timelock wallets, multisig/social recovery, sealed letters) mostly solved the *transfer* and failed on the *humans*:
- **Check-in fatigue**: owners forget to prove they're alive; a lawyer never asks you to check in monthly.
- **False triggers**: hospital, retreat, lost phone.
- **Heirs** don't know assets exist, or can't claim them technically.
- **Single-chain**: Bitcoin-only or EVM-only tools.
- **No dry run**, wills go stale, no legal standing.
- **Seed phrases can't go in a legal will** (wills become public).

### 2.3 Design principles (non-negotiable — the whole pitch rests on these)
1. **Passive liveness, active escalation.** Watch normal activity in the background; ask humans for nothing until signals go quiet.
2. **Signals can stop it; only people can start it.** Any sign of life can delay/cancel. Silence alone can never trigger execution. Execution requires a guardian quorum + a challenge period.
3. **Private by construction.** The liveness agent and sealed instructions run inside a TEE. Only timestamps leave the TEE, never content. In-product AI that touches will contents uses **NEAR AI Cloud** (TEE inference), never a non-private API.
4. **Staged and reversible as long as possible.** Release in slices, smallest first; any sign of life between stages halts the rest.
5. **Owner never loses control while alive.** Owner can withdraw from vaults and cancel at any stage.
6. **Honest about limits.** Shade Agent Framework is experimental and testnet-only; vault model requires moving funds; simulated signals are labelled.

### 2.4 Threat model (put a version of this in `docs/THREAT_MODEL.md` and the README)
| Attacker | Goal | Defenses |
|---|---|---|
| Greedy heir (± a colluding guardian) | Early access while owner is alive | Guardian threshold + independence; challenge period with loud owner notifications on every channel; liveness veto; staged release |
| Outsider | Steal vault funds | Only the attested agent can request MPC signatures, and only when the will is `Executing`; owner withdrawals are owner-signed |
| Platform / developer (us) | Read wills or sealed notes | Notes encrypted to a TEE-held key; agent code hash approved on-chain; attestation shown in UI. **Gap:** with Phala's centralized KMS, the Phala account holder can upgrade the CVM in place to code that gets the same key (§7.5); mitigated by published compose hashes + live compose hash in UI; backlog: on-chain KMS with timelocked allowlist |
| Account hijacker after death | Keep posting to block heirs forever | Guardian liveness-override (supermajority + evidence) — backlog item |
| Owner's own mistakes | Forgetting, lost keys | No check-ins required; stale-will review; fire drill (backlog) |

---

## 3. NEAR technology used (and where)

| Tech | Use | Where |
|---|---|---|
| NEAR smart contract (Rust, near-sdk) | Will state machine, guardians, policy hash, NEAR-native vault, agent registry, signature gating | `contract/` |
| **Chain Signatures** (MPC signer `v1.signer-prod.testnet`, 8 nodes) | Derived vault addresses on Ethereum Sepolia and Bitcoin testnet; signing release/withdrawal transfers | `contract/` (sign gating), `agent/src/chains/` |
| `chainsig.js` | Address derivation, tx building, signature formatting for EVM + Bitcoin | `agent/src/chains/` |
| **Shade Agent Framework** (TEE on Phala Cloud) | The Will Agent: liveness polling, escalation, execution, sealed-note crypto | `agent/` |
| **NEAR AI Cloud** (OpenAI-compatible, TEE inference, attestation) | Plain-English will → structured policy; heir claim guide; attestation badge | `agent/src/ai/`, `web/` |
| Named accounts, function-call keys | Readable heirs/guardians; (backlog) caretaker allowance in incapacity mode | `contract/`, `web/` |
| Meta transactions (backlog) | Gasless claims for non-crypto heirs | `web/`, relayer |
| NEAR Intents / 1Click (optional, mainnet, backlog) | Heir chooses "receive as USDC on chain X". No testnet exists for Intents — mainnet small amounts only, human approval required | `agent/src/intents/` |

Key facts confirmed from docs (Oct 26, 2026):
- Chain Signatures MPC contract: testnet `v1.signer-prod.testnet`, mainnet `v1.signer`. Addresses derive from (calling NEAR account, derivation path, MPC master key). The sign call yields and resumes, so it takes time to return. Bitcoin needs one signature per UTXO.
- Shade Agent Framework: experimental, known critical vulnerabilities, **testnet only**. Template: `https://github.com/NearDeFi/shade-agent-template`. CLI: `npm i -g @neardefi/shade-agent-cli` (`shade auth`, `shade deploy`, `deployment.yaml` with `environment: local | TEE`, `network: testnet`). Default agent contract implements `approve_codehash`, `register_agent`, `request_signature`. Every agent code change → new image → new code hash → re-approve.
- NEAR AI Cloud: base URL `https://cloud-api.near.ai/v1` (OpenAI SDK compatible). Attestation: `GET /v1/attestation/report?model={model}&signing_algo=ecdsa&nonce={nonce}`. Chat signature: `GET /v1/signature/{chat_id}`. Verifier examples: `near-examples/nearai-cloud-verification-example`, `nearai/nearai-cloud-verifier`.
- NEAR Intents: **no testnet**. 1Click API base `https://1click.chaindefuser.com/`. Partner Portal key avoids a 0.2% fee.

[VERIFY] before use:
- Current layout of the Shade template (contract language/location, how to extend the agent contract, current CLI flags).
- Whether `request_signature` / MPC `sign` requires an attached deposit, and how much.
- Which Bitcoin test network the `chainsig.js` BTC adapter targets (testnet3 vs testnet4) and a matching RPC (e.g. mempool.space API).
- ~~Phala dstack deterministic key derivation~~ **Resolved 2026-10-27 (spike 4):** stable per app_id across restart, in-place compose update and in-place OS upgrade; a new CVM gets a new key. See §7.5 and the Decision log.
- NEAR AI Cloud model IDs currently available (`GET /v1/models`) and pricing.

---

## 4. Architecture

```
┌──────────────┐  create will · seal notes · attest · claim   ┌───────────────────────────┐
│  web/        │ ─────────────────────────────────────────────▶│ contract/ (Rust)          │
│  Next.js     │                                               │ will state machine        │
│  + heartbeat │◀── reads state, balances, attestation ────────│ + Shade agent registry    │
│  PWA route   │                                               │ + sign gating             │
└──────┬───────┘                                               └─────────────┬─────────────┘
       │ heartbeat pings / policy drafts                                     │ request_signature
       ▼                                                                     │ (only when Executing,
┌──────────────────────────────┐   record_liveness / advance                 │  or owner withdrawal)
│ agent/  (Shade Agent, TEE)   │ ────────────────────────────────────────────┘
│ · signal adapters (real+sim) │──▶ NEAR AI Cloud (policy parsing, heir guide)
│ · liveness scoring/baseline  │
│ · escalation driver + email  │──▶ MPC signer v1.signer-prod.testnet
│ · executor (chainsig.js)     │──▶ NEAR testnet · Ethereum Sepolia · Bitcoin testnet
│ · sealed-note crypto         │
└──────────────────────────────┘
```

### 4.1 Repo layout
```
/
├─ CLAUDE.md               ← this file
├─ HACKATHON.md            ← copy of the official file
├─ README.md               ← judge-facing (see §11)
├─ .env.example
├─ contract/               ← Rust NEAR contract (extends Shade agent contract)
│  ├─ src/lib.rs, state.rs, will.rs, guardians.rs, signing.rs, vault.rs, events.rs
│  └─ tests/               ← near-workspaces sandbox tests
├─ agent/                  ← TypeScript Shade Agent
│  ├─ src/index.ts         ← API server + scheduler
│  ├─ src/signals/         ← adapter interface + adapters (real + simulated)
│  ├─ src/liveness/        ← scoring, baseline
│  ├─ src/escalation/      ← ladder driver, notifications
│  ├─ src/chains/          ← near.ts, evm.ts, btc.ts (chainsig.js)
│  ├─ src/executor/        ← staged release
│  ├─ src/sealed/          ← TEE keypair, decrypt, re-seal to heir
│  ├─ src/ai/              ← NEAR AI Cloud client, policy parser, attestation
│  └─ test/
├─ web/                    ← Next.js app (owner, guardian, heir, demo panel, heartbeat PWA)
├─ scripts/                ← demo-cancel.ts, demo-execute.ts, fund-vaults.ts, seed.ts
└─ docs/                   ← SPEC.md, THREAT_MODEL.md, DEMO.md, DECISIONS.md (optional)
```

### 4.2 Stack
- Contract: Rust, `near-sdk`, `cargo-near`, `near-workspaces` for tests.
- Agent: Node 20+, TypeScript, the Shade template's server framework, `chainsig.js`, `viem` (EVM), `openai` SDK pointed at NEAR AI Cloud, `libsodium-wrappers` (sealed boxes), `zod` (schema validation), `resend` (email), `vitest`.
- Web: Next.js (App Router), TypeScript, NEAR Wallet Selector, Tailwind, `libsodium-wrappers` in the browser.
- Package manager: pnpm workspaces (or whatever the template uses — don't fight it).

---

## 5. Contract specification

### 5.1 Data model (one contract, many wills keyed by owner)
```rust
enum WillState {
    Active,
    Quiet { since: u64 },            // silence passed threshold; owner nudged
    WelfareCheck { since: u64 },     // trusted contacts asked
    GuardianVote { since: u64 },     // guardians asked to attest
    Challenge { since: u64 },        // quorum reached; owner can still cancel
    Executing { stage: u8, stage_started: u64 },
    Completed,
}

struct Will {
    owner: AccountId,
    heirs: Vec<Heir>,                 // account, display name, x25519 pubkey (set at claim)
    guardians: Vec<AccountId>,
    guardian_threshold: u8,           // e.g. 2 of 3
    contacts: Vec<AccountId>,         // welfare-check contacts (may also be off-chain emails)
    policy_hash: [u8; 32],            // sha256 of approved policy JSON (policy stored off-chain + in web)
    stages: Vec<Stage>,               // e.g. [10%, 30%, 60%]
    timings: Timings,                 // all durations in seconds
    state: WillState,
    last_alive_at: u64,               // set by agent (scored signals) or owner directly
    attestations: Vec<GuardianAttestation>, // guardian, kind (Deceased|Alive), evidence_hash, at
    sealed_notes: Vec<SealedNote>,    // ciphertext (base64, size-capped), heir, label
    released_notes: Vec<ReleasedNote>,// re-sealed to heir pubkey after execution
    vaults: Vaults,                   // derivation paths per chain + NEAR balance held
    pending_withdrawals: Vec<Withdrawal>,
    executed: Vec<ExecutionRecord>,   // stage, chain, tx hash, amount
}

struct Timings { quiet_after: u64, nudge_period: u64, welfare_period: u64,
                 vote_period: u64, challenge_period: u64, stage_interval: u64 }
```
- **Demo timings** (seconds): quiet_after 120, nudge 60, welfare 60, vote 300, challenge 120, stage_interval 60. **Real defaults** (documented, not used in demo): quiet_after = adaptive (agent), nudge 7d, welfare 7d, vote 30d, challenge 30d, stage_interval 30d.
- Storage: owner attaches deposit for storage (NEAR storage staking). Cap each sealed note (e.g. 2 KB ciphertext) and count.

### 5.2 Methods
Owner:
- `create_will(heirs, guardians, guardian_threshold, contacts, stages, timings, policy_hash)` — payable for storage.
- `update_will(...)` — only in `Active`.
- `deposit_near()` — payable; adds to the will's NEAR vault balance.
- `i_am_alive()` — sets `last_alive_at = now`; from any state before `Completed` → `Active` (if `Executing`, halts remaining stages and records partial execution).
- `add_sealed_note(heir, label, ciphertext)` / `remove_sealed_note(id)`.
- `request_withdrawal(chain, to, amount)` — only in `Active`; agent fulfils it (foreign chains) or contract transfers (NEAR).

Agent (must be a registered agent with an approved code hash):
- `record_liveness(owner, at)` — agent's scored "alive" timestamp; resets to `Active` from any pre-execution state if `at` is newer than the state's `since`.
- `set_agent_pubkey(x25519_pubkey)` — TEE public key for sealed notes.
- `request_signature(owner, chain, payload, path, purpose)` — **gated**: allowed only if (a) `purpose = Release` and will is `Executing` and that stage/chain isn't already marked signed, or (b) `purpose = Withdrawal` matching a pending owner withdrawal. Derivation path must equal the will's vault path for that chain. Forwards to the MPC signer.
- `record_execution(owner, stage, chain, tx_hash, amount)`.
- `store_released_note(owner, note_id, heir, reciphertext)`.

Guardians / contacts:
- `attest(owner, kind: Deceased | Alive, evidence_hash)` — only in `GuardianVote`. `Alive` from any guardian → back to `Active`. When `Deceased` count ≥ threshold → `Challenge`.
- `contact_confirm_alive(owner)` — registered contacts; only in `Quiet`/`WelfareCheck`; → `Active`. (Safe direction: can only delay.)

Heirs:
- `register_heir_key(owner, x25519_pubkey)` — called by the heir account itself.

Anyone:
- `advance(owner)` — moves the state machine forward if the relevant period has elapsed. NEAR vault releases happen here (contract `Promise::transfer`) at each `Executing` stage.

Views: `get_will(owner)`, `get_state(owner)`, `get_vault_paths(owner)`, `get_agent_pubkey()`, `get_released_notes(owner, heir)`.

### 5.3 Transition table (implement exactly; test every row)
| From | Trigger | Guard | To |
|---|---|---|---|
| Active | advance | now − last_alive_at ≥ quiet_after | Quiet (agent sends nudge) |
| Quiet | advance | elapsed ≥ nudge_period | WelfareCheck (agent emails contacts) |
| WelfareCheck | advance | elapsed ≥ welfare_period | GuardianVote (agent notifies guardians) |
| GuardianVote | attest(Deceased) | count ≥ threshold | Challenge (agent notifies owner on all channels) |
| GuardianVote | attest(Alive) | — | Active |
| GuardianVote | advance | elapsed ≥ vote_period, threshold not met | Active (event `vote_failed`) |
| Challenge | advance | elapsed ≥ challenge_period | Executing{stage 0} |
| Executing{n} | advance | elapsed ≥ stage_interval and n+1 < stages | Executing{n+1} |
| Executing{last} | advance | stage done | Completed |
| any pre-Completed | i_am_alive / record_liveness(newer) | — | Active (partial execution recorded if any) |
| Quiet/WelfareCheck | contact_confirm_alive | caller is contact | Active |

Emit NEP-297 style JSON events for every transition (the web timeline reads them).

### 5.4 Contract tests (write these first)
Every row of §5.3; cancel at every stage; guardian not in list rejected; double attestation rejected; threshold edge (exactly threshold); `request_signature` rejected in every non-Executing state and for wrong path/purpose; withdrawal only by owner and only Active; `update_will` rejected after Active; storage deposit accounting; partial execution recorded when owner returns mid-execution.

---

## 6. Vaults and Chain Signatures

- Derivation paths (hardcode the format): `heirloom/<owner_account>/eth`, `heirloom/<owner_account>/btc`. The deriving account is the agent/will contract account, so only the contract can request signatures for them.
- NEAR vault: NEAR held in the contract, tracked per will (`deposit_near`). Released with `Promise::transfer` on `advance` during execution.
- ETH (Sepolia): native ETH transfer for MVP; ERC-20 (e.g. test USDC) is backlog.
- BTC (testnet): P2WPKH via chainsig.js; one MPC signature per UTXO. **Fallback if BTC fights us on Day 2: ship NEAR + ETH, return to BTC on Day 6.**
- Stage amounts: each stage releases `stage_pct × vault_balance_at_execution_start` per chain, split across heirs per policy. Snapshot balances when entering `Executing{0}`.
- Gas/fees: the agent must estimate EVM gas and BTC fees and leave enough in each vault for the final stage. Document the approach.

---

## 7. The Will Agent

### 7.1 Signal adapters (pluggable — the core of the liveness design)
```ts
export type SignalSource =
  | 'near_onchain' | 'evm_onchain' | 'phone_heartbeat' | 'github'
  | 'google_calendar' | 'gmail' | 'x' | 'instagram';

export interface SignalAdapter {
  source: SignalSource;
  simulated: boolean;              // MUST be true for simulated sources; surfaced in UI + README
  trustWeight: number;             // 0..1, how hard the signal is to fake (see table)
  /** Returns the most recent activity time for this owner, or null. Never returns content. */
  lastActivity(owner: OwnerSignalConfig): Promise<Date | null>;
}
```
| Source | Hackathon status | trustWeight | Notes |
|---|---|---|---|
| near_onchain | **real** | 0.9 | Any tx signed by owner's NEAR account (FastNear / NearBlocks API) |
| evm_onchain | **real** | 0.9 | Owner's personal Sepolia address (not the vault) via Etherscan API / RPC |
| phone_heartbeat | **real** | 0.9 | `web/heartbeat` PWA posts a signed ping when opened (owner key or per-device token) |
| github | **real** | 0.5 | Public events API; token for rate limit |
| google_calendar / gmail | simulated → real later | 0.7 | OAuth in testing mode, tokens stay in TEE |
| x | **simulated** | 0.4 | API is paid/limited; demo button "simulate post" |
| instagram | **simulated** | 0.4 | API restricted for personal accounts |

Simulated adapters read from a local store the demo panel writes to (`POST /demo/signal {source, at}`), and are tagged `SIMULATED` everywhere.

### 7.2 Liveness scoring
- Poll all adapters every N seconds (demo: 15s).
- A signal counts as "alive" if its weight ≥ 0.7 **or** several weaker signals agree within a window. Rationale: social posts can be scheduled or run by someone else; signed on-chain txs and phone heartbeats are hard to fake.
- When the score says alive at time T newer than the contract's `last_alive_at`, call `record_liveness(owner, T)`.
- **Baseline** (adaptive `quiet_after`, real mode only): median gap between strong signals over the last 90 days × a multiplier, clamped to [7d, 60d]. Plain statistics; no AI needed.
- **Privacy rule:** adapters return timestamps only. Never log, store, or transmit content.

### 7.3 Escalation driver
- Each tick: read state; if a period has elapsed, call `advance(owner)`; on each new state, send notifications:
  - Quiet → nudge owner (email + heartbeat app).
  - WelfareCheck → contacts: "Have you heard from <name> recently? Confirm they're fine: <link>".
  - GuardianVote → guardians: attest link with what's known.
  - Challenge → owner on **every** channel: "Your will executes in X. Any activity cancels it."
- Email via Resend. If not configured, notifications appear in the web UI's notification log (cut line).

### 7.4 Executor
- On `Executing{n}`: for each foreign chain with balance: build transfers per policy (chainsig.js) → `request_signature` via contract → format signature → broadcast → `record_execution`. NEAR stage transfers happen in the contract on `advance`.
- Idempotent: check `executed` records before signing; never double-send.

### 7.5 Sealed instructions
- **Key derivation (verified in spike 4, see Decision log 2026-10-27):** at boot the agent calls dstack `getKey(path="heirloom/sealed-notes", purpose="x25519-v1")` over `/var/run/dstack.sock`. That returns 32 bytes, derived by the Phala KMS from (KMS root, **app_id**, path, purpose). The agent then runs libsodium `crypto_box_seed_keypair(seed)`, zeroes the seed, and keeps the private key **in memory only**. It is never written to disk, logged or returned by any route. Changing `purpose` (`x25519-v2`) is how we rotate deliberately.
- **What keeps the key:** a restart, stop/start, an in-place compose update (new code, new compose hash, new measurements) and an in-place dstack OS upgrade all keep the same key. **What loses it:** a new CVM gets a new app_id and so a new key, even with an identical compose. That includes every `shade deploy` with `deploy_to_phala`, and deleting and recreating the CVM.
- **Operational rule:** provision the TEE agent's CVM **once** and record its app_id in the README and in the contract (`set_agent_pubkey` stores the pubkey plus app_id). Every later agent change ships as an **in-place compose update** (`provisionCvmComposeFileUpdate` + `commitCvmComposeFileUpdate`; script it as `scripts/upgrade-agent.ts`), followed by `approve_measurements` for the new compose hash. **Never** run `shade deploy` against Phala again for this agent, and never delete its CVM.
- Agent publishes the public key with `set_agent_pubkey`. The contract accepts it from a registered agent **only while unset**. Changing it later needs the contract owner (explicit rotation). At boot the agent compares its derived pubkey with `get_agent_pubkey()`. On a mismatch it refuses all sealed-note work and logs that loudly. It never overwrites the key silently, because a new app_id would otherwise strand every existing note.
- Browser encrypts each note with libsodium `crypto_box_seal` to the agent pubkey; only ciphertext goes on-chain.
- Heir, when claiming, generates an X25519 keypair in the browser (saved locally + downloadable backup) and calls `register_heir_key` from their NEAR account.
- After execution starts, agent decrypts inside the TEE and re-seals to the heir's pubkey (`store_released_note`). Heir decrypts in the browser.
- **Disaster recovery (not the normal path):** if the CVM or its app_id is lost (deleted, Phala account problem, KMS change), the old key is gone. Then the owner re-seals: a new agent publishes a new key through owner-approved rotation, and the web app flags notes sealed to the old key and asks the owner to re-encrypt them. Document this as a known limitation.
- **Honest trust note (README §7 and THREAT_MODEL):** we use Phala's **centralized KMS** (`kms_type: phala`), so whoever controls the Phala account can push a new compose in place, and that code would get the **same key**. Approving measurements on the agent contract does not stop it, because the KMS doesn't consult our contract. So "the developer can't read notes" rests on our operational discipline plus Phala's KMS, not on cryptography alone. Mitigations: publish every compose hash we deploy, keep public logs on, and show the live compose hash next to the approved measurements in the UI. Backlog: move to dstack's **on-chain KMS** (DstackApp contract with a compose-hash allowlist behind a timelock or multisig), which makes upgrades public and delayed.
- Also verify the KMS signature chain that `getKey` returns (2 signatures, proving the key belongs to this app_id under the KMS root in `key_provider_info`) in the attestation panel (Day 3, nice-to-have).
- UI guidance for owners: don't store a complete secret in one note (e.g. split seed phrase and passphrase); location/instructions notes are often safer and just as useful.

### 7.6 AI layer (NEAR AI Cloud only, because it handles will contents)
- Client: `openai` SDK with `baseURL: https://cloud-api.near.ai/v1`, key from env. Choose a capable model from `/v1/models` [VERIFY]; record the choice in the Decision log.
- **Policy parser:** plain-English will → JSON matching the schema below. Validate with zod. Deterministic checks after the model: shares per asset sum to 100%, every heir referenced exists, stages sum to 100%. On failure, show errors; never auto-fix silently. The owner must approve a human-readable summary before `policy_hash` is set.
- **Heir claim guide:** a chat that explains, in plain language, what's happening and what to click next. Fed only the heir's own claim info.
- **Attestation badge:** fetch `/v1/attestation/report` with a fresh nonce, verify per the example repo, show "Verified private inference" with details in a popover. Also show the agent's approved code hash from the contract.

```json
{
  "version": 1,
  "owner": "alice.testnet",
  "heirs": [
    { "id": "h1", "name": "Bola", "near_account": "bola.testnet",
      "receive": { "eth": "0x…", "btc": "tb1…" } },
    { "id": "h2", "name": "Charity Fund", "near_account": "charity.testnet",
      "receive": { "eth": "0x…" } }
  ],
  "allocations": [
    { "asset": "NEAR", "shares": { "h1": 80, "h2": 20 } },
    { "asset": "ETH",  "shares": { "h1": 100 } },
    { "asset": "BTC",  "shares": { "h1": 50, "h2": 50 } }
  ],
  "conditions": [
    { "heir": "h1", "asset": "BTC", "type": "not_before", "date": "2031-05-01",
      "note": "BTC to Bola when he turns 21" }
  ],
  "stages_pct": [10, 30, 60],
  "guardians": ["g1.testnet", "g2.testnet", "g3.testnet"],
  "guardian_threshold": 2,
  "contacts": ["friend@example.com"]
}
```
(`conditions` is parsed and displayed in the MVP; enforcing time conditions is backlog — say so in the README.)

---

## 8. Web app

Pages:
- `/` — landing: one-liner, how it works (the ladder diagram), "Try the demo" button.
- `/owner` — create will (plain-English box → parsed summary → approve), vault addresses + live balances per chain, liveness timeline (per source, SIMULATED tags), current state on the ladder, sealed notes (add/remove), "I'm alive" button, withdrawal, attestation badges.
- `/guardian/[owner]` — what's known (last signals, state), attest Deceased/Alive with evidence upload (hash on-chain, file stays off-chain).
- `/heir/[owner]` — guided claim: register key, see released amounts + tx links per chain, decrypt sealed notes, AI guide chat.
- `/demo` — **demo control panel for judges**: create a pre-seeded demo will, compressed clock, "simulate activity" per source, "advance" button, live event log. Clearly marked as demo tooling.
- `/heartbeat` — installable PWA: one big "I'm here" plus passive ping on open.

Design: calm, trustworthy, not "crypto-bro". Plain language everywhere ("your will", "guardians", "release in stages"), technical details in expandable panels.

---

## 9. Demo scenarios (these are the acceptance tests for the MVP)

**Scenario A — "Silence doesn't kill you" (cancel):**
1. Demo will exists with vaults funded on NEAR, Sepolia, BTC testnet.
2. Stop all signals → state goes Quiet → WelfareCheck → GuardianVote (notifications visible).
3. Two guardians attest Deceased → Challenge, owner notified on every channel.
4. Open the heartbeat app, or simulate two weak signals (e.g. X post + Instagram post) → **everything cancels**, state back to Active, no funds moved. A lone X post is shown **not** cancelling first, to demonstrate §7.2.

**Scenario B — "It actually executes" (release):**
1. Same, but no sign of life during Challenge.
2. Executing stage 1 (10%) → transfers land on NEAR, Sepolia and BTC testnet; explorer links shown.
3. Heir opens claim page → guided flow → registers key → decrypts sealed note ("The Ledger is in the blue folder in the study…").
4. Owner "returns" mid-execution → remaining stages halt; partial execution recorded.

Scripts: `scripts/demo-cancel.ts`, `scripts/demo-execute.ts` run both end-to-end headlessly; the README links them.

---

## 10. Environment variables (`.env.example`, placeholders only)
```
NEAR_NETWORK=testnet
NEAR_ACCOUNT_ID=
NEAR_SEED_PHRASE=            # never commit
NEXT_PUBLIC_contractId=      # per Shade template convention [VERIFY]
MPC_CONTRACT_ID=v1.signer-prod.testnet
PHALA_API_KEY=
NEARAI_API_KEY=
NEARAI_MODEL=
SEPOLIA_RPC_URL=
ETHERSCAN_API_KEY=
BTC_NETWORK=testnet          # [VERIFY] testnet3 vs testnet4
BTC_API_URL=                 # e.g. mempool.space testnet API
GITHUB_TOKEN=
RESEND_API_KEY=
NOTIFY_FROM_EMAIL=
DEMO_MODE=true
```

---

## 11. README requirements (judge-facing; AI judges read it)
1. What it is (2–3 sentences) and the problem (with the "why past attempts failed" table).
2. **Try it in 5 minutes:** numbered "do X → see Y" steps on testnet using `/demo`, no real money.
3. How it works: the ladder diagram, the two principles (passive liveness; signals stop it, only people start it).
4. NEAR tech used and where in the code (table from §3).
5. Privacy: what runs in the TEE, what leaves it (timestamps only), attestation.
6. Threat model.
7. Honest limitations: Shade Agent Framework is experimental/testnet-only; vault model; simulated signals (listed); `conditions` not enforced yet; key persistence approach.
8. Roadmap (backlog §13).
9. Credits: Shade Agent template (upstream link) and vendored code with its licenses; built with Claude Code.

---

## 12. Build plan

> **Dates:** "Day N" means build day N, counted from when the submission repo starts. That can be before Nov 1. The calendar dates in the headings are the original plan.

### Phase 0 — spikes (separate `heirtest/` workspace; nothing copied over except knowledge)
- [x] Deploy Shade Agent template locally, then once to Phala; have it sign + send a Sepolia tx. (Done 2026-10-27, local + TEE.)
- [x] Derive a BTC testnet address with chainsig.js; send one tx from it. Note the network and RPC that worked. (Done 2026-10-27: testnet4 via mempool.space.)
- [x] Call NEAR AI Cloud; verify one model attestation with the example repo. (Done 2026-10-27: z-ai/glm-5.3-flash, all 7 checks.)
- [x] Confirm all [VERIFY] items in §3; record answers in the Decision log. (Done 2026-10-27; last one was dstack key persistence, spike 4.)

### Day 1 (Nov 1) — Contract
- Import template as first commit. Implement §5 with tests first (§5.4). Deploy to testnet. Derive + fund vaults.
- ✅ CLI-only: create will → walk every state → cancel with `i_am_alive`.

### Day 2 (Nov 2) — Agent + money movement
- Signal adapters (real: near_onchain, evm_onchain, github; simulated store), scoring, escalation driver, notifications. Executor for NEAR, ETH, then BTC. One Phala TEE deploy to confirm.
- ✅ CLI-only run: silence → … → execution with funds landing on 3 chains (or 2 if BTC is cut).

### Day 3 (Nov 3) — AI + sealed notes + attestation
- Policy parser + validation + approval → policy_hash. Sealed-note crypto end to end. Attestation verification (NEAR AI Cloud + agent code hash).
- NEAR AI attestation = **vendor and adapt** the TS checks from `nearai/nearai-cloud-verifier` `ts/model_verifier.ts` (`checkTdxQuote`, `checkReportData`, `checkGpu`, the mr_config/compose check) into `agent/src/ai/attestation.ts`. Return a structured pass/fail per check and log nothing. Add `@phala/dcap-qvl-node` (WASM). Use ethers v6 `verifyMessage` for the chat signature. Keep the MIT notice and credit the source. On startup and before any will-content request: refuse if any check fails, or if the configured model has no attestation. Badge shows: TDX quote `UpToDate` + report data binds signer + nonce + NVIDIA verdict + signature recovers to attested address.
- ✅ Write will in English → seal a note → execute → only the heir can decrypt.

### Day 4 (Nov 4) — Web
- All pages in §8, including `/demo` and `/heartbeat`.
- ✅ Scenarios A and B run fully in the browser.

### Day 5 (Nov 5) — End to end + README + rough demo
- Run A and B repeatedly, fix bugs, demo scripts, README per §11, threat model doc, rough recording.
- ✅ A judge following only the README can reproduce both scenarios.

### Cut lines (in order, if behind)
1. Drop BTC (keep NEAR + ETH). 2. Notifications in UI only (no email). 3. Fixed silence threshold instead of baseline. **Never cut:** the cancel moment, cross-chain release, sealed note to heir.

---

## 13. Backlog (Nov 6–14, alongside the human's other work)
- Hardening: guardian disagreement, partial vault funding, fee estimation, BTC UTXO edge cases, more tests, idempotency audit.
- Guardian liveness-override (supermajority + evidence) for hijacked accounts.
- **Fire drill mode:** rehearse execution with heirs/guardians on a throwaway testnet will.
- **Incapacity mode:** caretaker gets a capped allowance via function-call keys/sub-account.
- **Stale-will review:** detect new uncovered assets / empty vaults; AI explains.
- Real Google Calendar/Gmail adapter (OAuth testing mode, tokens in TEE).
- ERC-20 / test USDC vaults; enforce `conditions` (e.g. not_before).
- Gasless heir claims (meta transactions/relayer); named account onboarding for non-crypto heirs.
- Lawyer companion letter (generated, mentions the plan exists, no secrets).
- Optional mainnet moment: heir receives as USDC on another chain via 1Click (small real amount, **human approval required**).
- Demo video (60–90s), X post draft for the human, final README pass. Submit early — human does it.

---

## 14. Status (update every session)
- **Phase:** Day 2 done, including the one TEE deploy (2026-10-28). Next is Day 3 (AI + sealed notes + attestation).
- **Last checkpoint:** ✅ Day 2. Scenario B ran end to end on NEAR, Sepolia and BTC testnet4 with a local agent (links in the Decision log, 2026-10-27). Then the TEE agent was provisioned and registered with a real TDX attestation on `inheirit.testnet` (`requires_tee: true`).
- **TEE agent (provision once; never re-create, §7.5):** CVM `inheirit-agent`, vm `e3685437-e716-493a-ac4e-3717a72e7fdd`, **app_id `d5b714731becca502b6bd054a5cf6ffa5ce71f61`**, dstack-0.5.12, tdx.small, gateway `dstack-pha-prod9.phala.network`. Image `unwizarding/inheirit-agent@sha256:3724f713…b416`, compose hash `aceea836b8f03fd1931d63b8c585e8955999a7cb6333fc8538a7545b5db2e81e`. Agent account `9945ff0cca6378c2a0ada3f972bdc673f13f5ba9a6309c734bc48cad16ecc97f`. API: `https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network`. Logs: `https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-8090.dstack-pha-prod9.phala.network/logs/shade-agent-app?text&bare&timestamps&tail=50`. Record in `deploy/tee-agent.json`; tool `scripts/tee-agent.ts provision|approve|status|stop|start` (the human runs it: keyring credentials). It costs about $0.06/h while running; `stop` keeps the app_id and key.
- **Next step:** Day 3. Before then: (1) a local-mode dev contract `inheirit-dev.testnet` for local runs (TEE mode disables whitelisting); needs about 10 faucet NEAR, because paid-outside has 6.0. (2) `scripts/upgrade-agent` (in-place compose update + approve) before the next agent change. (3) Push the TEE commits on `agent-day2` (needs the human's OK).
- **Blockers / open questions:** (1) Owner signal registration (`/api/owners`) is demo-only until NEP-413 on Day 4. (2) Local machine: `/etc/hosts` pins `mempool.space` to `103.165.192.202`; remove it once the network is fixed. (3) Demo wills on `inheirit.testnet` were wiped by the TEE redeploy; the demo needs fresh owners.

## 15. Decision log (append; newest last)
- 2026-10-26 — Project chosen: cross-chain crypto will ("Heirloom", working name; final name must be unique in the hackathon).
- 2026-10-26 — Principles: passive liveness; signals can only stop execution; only a guardian quorum + challenge period can start it; staged release.
- 2026-10-26 — Real signals for MVP: NEAR on-chain, Sepolia on-chain, phone heartbeat PWA, GitHub. Simulated: X, Instagram, Google Calendar/Gmail (Google is first upgrade).
- 2026-10-26 — In-product AI uses NEAR AI Cloud only (privacy claim). Claude Code is the build tool.
- 2026-10-26 — Will logic lives in the Shade agent's custom contract so signature gating is in one place.
- 2026-10-26 — NEAR Intents has no testnet; core runs on testnet; any Intents usage is an optional, human-approved mainnet extra.
- 2026-10-27 — [VERIFIED from template code, commit 816b75b; shade-agent-cli 2.4.0, shade-agent-js 2.2.0, shade-attestation 0.2.0] **Template layout:** agent is TypeScript on **Hono** (`src/index.ts`, `src/routes/*`, `src/utils/ethereum.ts`) using `ShadeClient` from `@neardefi/shade-agent-js`; contract is Rust in `agent-contract/` (near-sdk 5.26.1, edition 2024). Custom contract methods go in `agent-contract/src/your_functions.rs`. Package manager is **npm** with exact pins (`.npmrc save-exact`), not pnpm. We follow the template.
- 2026-10-27 — [DISCREPANCY: docs/code win over §3] There is **no `approve_codehash`** anymore. Agents are approved by **`approve_measurements`** (full TDX measurements, which cover the docker-compose/image) plus **`approve_ppids`**, and `register_agent(attestation)` verifies a dstack attestation. Registrations expire (`attestation_expiration_time_ms`, 7 days by default), and the agent re-registers every 6 days. Local mode: `requires_tee=false`, and the owner whitelists the agent account with `whitelist_agent_for_local` (`shade whitelist`). Every agent code change still means a new image → new measurements → re-approve. In our docs, read "code hash" as "approved measurements".
- 2026-10-27 — [VERIFIED] **Deposit:** the agent's `request_signature(path, payload, key_type)` call attaches nothing. The contract forwards to MPC `sign({payload_v2, path, domain_id})` with **1 yoctoNEAR** and 15 Tgas static (`internal/chainsig.rs`). `domain_id` is 0 for Ecdsa (EVM/BTC) and 1 for Eddsa. `register_agent` needs a storage deposit (486 bytes) on first registration. The template's `request_signature` is **ungated** (any valid agent, any path or payload); our §5.2 gating must wrap it.
- 2026-10-27 — [VERIFIED] **Env var names:** `AGENT_CONTRACT_ID`, `SPONSOR_ACCOUNT_ID`, `SPONSOR_PRIVATE_KEY` (sponsor funds the agent's NEAR account). §10's `NEXT_PUBLIC_contractId` is outdated; use `AGENT_CONTRACT_ID`. The MPC contract is hardcoded `v1.signer-prod.testnet` in `src/utils/ethereum.ts` and passed to contract init via `<DEFAULT_MPC_CONTRACT_ID>`.
- 2026-10-27 — [VERIFIED] **Derivation:** the template derives the EVM address with `Evm.deriveAddressAndPublicKey(AGENT_CONTRACT_ID, "ethereum-1")`. The predecessor to MPC is the agent **contract**, which confirms §6: vault paths `heirloom/<owner>/eth|btc` derive under the contract account.
- 2026-10-27 — [VERIFIED] **CLI behaviour:** commands are `deploy | plan | reproduce | auth | whitelist`. Credentials live in the OS keyring (`@napi-rs/keyring`; works on our WSL2). `shade --version` prints `1.0.2` even though the installed package is 2.4.0 (cosmetic). `deploy` re-creates the contract account if it exists, wiping state, after a typed "yes". **Even local mode builds the contract inside Docker** (`pivortex/near-builder`) unless you use `deploy_from_wasm`.
- 2026-10-27 — [VERIFIED] **Contract build:** `cargo-near` 0.22 rejects rustc > 1.86 for this contract, so build with `cargo +1.86.0 near build non-reproducible-wasm --no-abi`. The `ring` dependency (via shade-attestation) needs **clang** for wasm32. With Docker available, the spike uses the template's default `deploy_from_source` (Docker builder image), which avoids both issues; building it ourselves is the fallback.
- 2026-10-27 — Upstream `package-lock.json` is out of sync for npm 11 (`npm ci` fails on missing optional @esbuild entries). Not a blocker locally. Check the Docker build (node 22 / npm 10) before the TEE deploy.
- 2026-10-27 — [VERIFIED] **Contract storage cost:** the template contract wasm is about 757 KB, so it needs about 7.6 NEAR of storage stake. The template's `funding_amount: 5` fails with "wouldn't have enough balance to cover storage". The spike uses 8.5. Our will contract will be larger, so budget 10+ NEAR for the contract account (faucet accounts start with 10). If an account exists with no state, re-running `shade deploy` tops it up to `funding_amount` and does not wipe it.
- 2026-10-27 — [VERIFIED] **Template issues found running locally (patched in the spike; re-apply on Day 1):** (1) shade-agent-js 2.2.0 with the default `numKeys: 1` in local mode always throws "First key and additional keys disagree on derivation method", because `[].every()` returns true. Fix: `numKeys: 2` in `ShadeClient.create`. (2) `register_agent` attaches 300 Tgas, so the agent needs about 0.31 NEAR up front, but the template funds only 0.3 when the balance drops below 0.2. Fix: fund 0.5 when below 0.5. (3) `sepolia.drpc.org` no longer serves Sepolia on its free plan. Use `https://ethereum-sepolia-rpc.publicnode.com` (tenderly gateway also works). `ethereum.ts` reads its constants when imported, before `dotenv.config()` runs in `index.ts`, so `.env` values aren't visible there. Our code should read env lazily.
- 2026-10-27 — Spike 1: agent contract `heirloom-spike-7k3q.testnet`. Local agent `2e14c536…0e25` is whitelisted and registered. Derived Sepolia address (path `ethereum-1`) is `0x75191796edA01897d775c899952BcB48268Dbbf9`.
- 2026-10-27 — [VERIFIED] **Spike 1 (local) works end to end:** agent → contract `request_signature` → MPC `v1.signer-prod.testnet` → signed Sepolia tx broadcast. Tx `0x7b4751fb7929685f1eb6ddace2f446a4d0230ce718d6d2f0988387b99ed0dd9a` sent 0.44 ETH from derived `0x7519…bbf9` to `0xA4d4…e47b`: status 1, block 12005242, 21000 gas. Spike-only route `POST /api/send-eth` (ungated).
- 2026-10-27 — [VERIFIED] **The MPC sign call can outlast the RPC wait.** The first `request_signature` got a 408 "Timeout error" from FastNEAR (the shade-agent-js default RPC), even though the NEAR tx executed and burned gas. The retry succeeded. Because `sign` pauses and resumes, the RPC response can time out after the tx has landed. The executor must treat a 408 as "outcome unknown": check the EVM nonce/balance and NEAR tx status before retrying, and rely on the EVM nonce for idempotency (only one tx per nonce can land). Each sign costs the agent about 0.009 NEAR in gas.
- 2026-10-27 — [VERIFIED] **WSL networking:** IPv6 is unreachable, and the IPv4 TCP connect to Cloudflare-hosted RPCs takes about 280 ms. That exceeds Node's 250 ms per-address limit when it tries IPv6 and IPv4 in turn, so Node `fetch` fails with ETIMEDOUT ("fetch failed") while curl works. Connect times vary from 0.3 to 1 s+ across every RPC (fastnear, near.org, drpc), so this is local latency. A 2 s attempt timeout was not always enough. Fix: `NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"` (10/10 OK versus 7/10 without). `ipv4first` on its own does not fix it.
- 2026-10-27 — [VERIFIED] **shade CLI on Linux always runs `sudo docker …`,** so Docker Hub needs a root login (`sudo docker login -u <user>` with an access token). A login in Docker Desktop alone gives "push access denied … insufficient_scope".
- 2026-10-27 — [VERIFIED] **Testnet gas costs about 0.001 NEAR per Tgas** (10× the CLI's assumption). The CLI wipes a redeploy with one 1000 Tgas transaction signed by the contract account, so that account needs about 1 NEAR free on top of its storage stake. Otherwise: "wouldn't have enough balance to cover storage". For redeploys, keep the contract account at storage + 1.5 NEAR.
- 2026-10-27 — [VERIFIED] **Spike 1 done in the TEE.** Phala CVM `heirloom-spike` (vm `69c353f8-78a3-4ecd-becd-47af801cb19a`, app `b07a3950…`, dstack-0.5.12, tdx.small, about $0.06/h). The agent `8b4c0bd9…6ce4` registered with a real TDX attestation and signed Sepolia tx `0xadd73fff8803a5fd025c28c18f6022b2d38c629ed972f8297116b10bff3fc69c` (status 1, block 12005790). The derived Sepolia address is unchanged across local→TEE, because it depends only on the contract ID and path.
- 2026-10-27 — [VERIFIED] **Shade CLI 2.4.0 is behind Phala.** Phala has disabled dstack-0.5.8 ("Teepod 26 has no compatible OS image") and only offers 0.5.12 / 0.6.1. The CLI's config only accepts 0.5.7/0.5.8 and has hardcoded measurement tables just for those. Workaround used: call the CLI's own `deployToPhala` (dist/src/utils/phala-deploy.js) with `dstackVersion: "0.5.12"`. Then read `mrtd`/`rtmr0-2`, the `key-provider` event digest and `compose-hash` from `GET cloud-api.phala.network/api/v1/cvms/<vm_uuid>/attestation` (`tcb_info`), and call `approve_measurements` by hand. Moving 0.5.8 → 0.5.12 changed only `mrtd`, `rtmr1` and `rtmr2`; compose hash, key-provider and `rtmr0` were unchanged. **For the real build:** verify the OS measurements independently (dstack's reproducible image or dstack-mr) instead of trusting Phala's API, and script this as `scripts/approve-measurements.ts`.
- 2026-10-27 — [VERIFIED] **The CLI's PPID list from Phala contains invalid entries** (one `""` and two 64-byte values). The contract's `Ppid = HexBytes<16>`, so `approve_ppids` panics ("Byte Vector of length 0"). Fix: filter to 32-hex-character entries (19 of 22) and approve by hand.
- 2026-10-27 — [VERIFIED] **The template's register loop burns NEAR.** On a failed `register_agent` (for example, measurements not approved), it retries about every 14 s. Each failed 300 Tgas call cost about 0.015–0.02 NEAR and drained 0.5 → 0.30 in about 6 min, after which the agent can't afford to try. Our agent needs backoff and a cap, and should log the reason clearly.
- 2026-10-27 — [VERIFIED] **Phala debugging endpoints:** CVM status/endpoints: `GET /api/v1/cvms/<vm_uuid>` (X-API-Key; the JSON contains raw newlines, so parse leniently). Container logs (public_logs) are at `https://<app_id>-8090.<gateway>/logs/<container>?text&bare&timestamps&tail=N`. App URL: `https://<app_id>-3000.<gateway>`.
- 2026-10-27 — [VERIFIED] **BTC network answer:** chainsig.js 1.1.16's `Bitcoin` adapter is network-agnostic. `network: "testnet"` selects bitcoinjs testnet params (`tb1…` P2WPKH), which are identical for testnet3 and testnet4. The actual network is chosen only by the Mempool adapter URL. We use **testnet4**: `BTC_API_URL=https://mempool.space/testnet4/api` (also responds: `/testnet/api`, `/signet/api`). Fees on 2026-10-27 were 1 sat/vB everywhere.
- 2026-10-27 — [VERIFIED] **chainsig.js BTC internals** (read from the source map): `value` is in **satoshis**. Fees use mempool's `hourFee` + 1 sat/vB with `coinselect`, and change goes back to `from`. There is one hash, and so one MPC `sign`, per input. `getBalance` counts **confirmed only** (`chain_stats`), so a fresh faucet UTXO shows 0 but is spendable. **`Mempool.fetchUTXOs` swallows fetch errors and returns `[]`**, so a network failure surfaces as "coinselect failed … insufficient funds". Our executor must fetch UTXOs itself and treat errors as errors.
- 2026-10-27 — [VERIFIED] **Spike 2 done.** Testnet4 tx `f783196d49e27e4f7990d40f117e0a44e1ced89b604bbf5d5341d3476df1c0f1` (https://mempool.space/testnet4/tx/f783196d49e27e4f7990d40f117e0a44e1ced89b604bbf5d5341d3476df1c0f1): 1 input (268,810 sats faucet UTXO, spent unconfirmed) → 20,000 to the stand-in heir `tb1qjzz0h4l7j3m9x7w6y8ezlmdslr7zfy75zqj7zg` + 248,358 change. Fee 452 sats (3.2 sat/vB; coinselect overestimates size). Signed by MPC `sign` called directly from `paid-outside.testnet` (path `heirloom-spike/btc`, domain 0, 1 yocto, 50 Tgas). Script: `spike2-btc/btc.cjs`. **One MPC signature took 58.5 s.** The executor must expect about 1 min per BTC input (EVM was faster). Budget N minutes for an N-UTXO vault, sign inputs in parallel where possible, and keep the demo vault to 1–2 UTXOs.
- 2026-10-27 — [VERIFIED] **Root cause of the "slow network":** `/etc/resolv.conf` (static; `wsl.conf` has `generateResolvConf=false`) lists `1.1.1.1` first, and 1.1.1.1 does not answer DNS on the home router network. So every lookup waits the 5 s resolver timeout before falling back to 8.8.8.8 (0.12 s). Fix: put `nameserver 8.8.8.8` first. Without sudo: `RES_OPTIONS="timeout:1 attempts:2 rotate"`. The Node IPv6-racing fix (above) is a separate issue and is still worth keeping.
- 2026-10-27 — [VERIFIED] **NEAR AI Cloud models: only some are private.** `GET /v1/models` lists 61 models, but **only 12 return an attestation report**: z-ai/glm-5.3(-flash), qwen/qwen3.5-397b-a17b, Qwen/Qwen3.8-27B, Qwen/Qwen3.6-35B-A3B-FP8, Qwen/Qwen3-VL-30B-A3B-Instruct, Qwen/Qwen3-Reranker-0.6B, deepseek/deepseek-v3.2, moonshotai/kimi-k3, moonshotai/kimi-k2.6, openai/privacy-filter, openai/whisper-large-v3. **All Anthropic/OpenAI-GPT/Google/xAI models, plus deepseek-v4.1-flash, kimi-k3.1-pro and qwen3.7-max, return 503 "TEE attestation"**: they are proxied, not private. Model metadata has no TEE flag, so the agent must check `/v1/attestation/report` for the configured model at startup and refuse to send will contents to a model that doesn't attest.
- 2026-10-27 — **Model choice: `NEARAI_MODEL=z-ai/glm-5.3-flash`.** It is attested, costs $0.08/M input and $0.50/M output, has a 1M context, and supports `json_mode` and `structured_outputs`. A test parse of "80% NEAR to bola.testnet, 20% to charity.testnet" returned correct JSON in 24 s (288 of 315 output tokens were reasoning). Fallback if quality is short: `Qwen/Qwen3.6-35B-A3B-FP8` (json_mode + structured_outputs) or `qwen/qwen3.5-397b-a17b`.
- 2026-10-27 — [VERIFIED] **Spike 3 done.** `near-examples/nearai-cloud-verification-example` (commit 12098c3) passed all 7 checks against z-ai/glm-5.3-flash: nonce echoed by the gateway and model TEE, NVIDIA NRAS GPU attestation (8× GH100, secure boot on, debug off, eat_nonce = our nonce), `provider_tee` signature text `model:sha256(request):sha256(response)` matched, and the signer recovered to the attested model address `0x3b75…fa0c`. Code is in `spike3-nearai/verifier`. **Gap:** that example does not verify the Intel TDX quote or that the signing key is bound into report_data. Resolved by the nearai-cloud-verifier spike below. Signatures must hash the exact request and response bytes, so the agent must keep the raw body strings.
- 2026-10-27 — [VERIFIED] **nearai-cloud-verifier spike** (`nearai/nearai-cloud-verifier` commit 9455472, run unchanged: `pnpm install --frozen-lockfile --ignore-scripts`, then `API_KEY=… npx tsx ts/model_verifier.ts --model z-ai/glm-5.3-flash`). **The TDX quote check passes.** Gateway TEE (`0xb98a…e779`) and model TEE (`0x3b75…fa0c`) both returned: Intel TDX quote verified, status `UpToDate`, no advisory IDs; report_data binds the signing address (first 32 bytes) and our nonce (second 32 bytes); mr_config = `01`‖sha256(app_compose); all Sigstore image links HTTP 200. The model also passed NVIDIA NRAS (verdict true, nonce match), and the compose-manager actions hash matched. **Language and dependencies:** it ships both Python 3.10+ (`requests`, `eth-account`, `dcap-qvl`, `cryptography`, `pynacl`) and TypeScript (Node 20+; `@phala/dcap-qvl-node` 0.3.3, which is **WASM with no native build**, plus `ethers` **v5**, `tweetnacl`, `ed2curve`). Network calls: cloud-api.near.ai, NVIDIA NRAS, Intel PCS (`api.trustedservices.intel.com`, for quote collateral), search.sigstore.dev. **Can our agent call it directly? No, it needs a light port (vendor and adapt), not a rewrite.** Reasons: (1) it is CommonJS with no exports map and no build output, while our agent is ESM (`"type": "module"`, Bundler resolution); (2) it isn't published by NEAR AI on npm, because the `nearai-cloud-verifier` npm name (0.0.1-alpha.1) has no repo link and an unrelated maintainer, so **don't install it**; (3) `verifyAttestation`/`main` only `console.log`, return void, and exit 0 even when a check fails, so it can't gate anything; (4) `chat_verifier.ts` uses ethers v5 `ethers.utils.verifyMessage`, while the agent pins ethers 6.16.0. The individual functions (`checkTdxQuote`, `checkReportData`, `checkGpu`) are small (about 150 lines), take a report and return results, and need only node `crypto` + `@phala/dcap-qvl-node`. So we vendor those into the agent. Note: the repo's package.json says Apache-2.0 but its LICENSE file is MIT; keep the LICENSE text with the vendored code. Code: `spike3-nearai/cloud-verifier`.
- 2026-10-27 — [VERIFIED] **Spike 4: does the dstack key survive restart and redeploy?** Probe = public `node:22-alpine` (pinned digest), with an inline script carried in the compose (no image build, no NEAR spent). It calls `GetKey("heirloom/sealed-notes","x25519-v1")` on `/var/run/dstack.sock` → libsodium 0.8.4 `crypto_box_seed_keypair`. It exposes only the X25519 pubkey, `sha256("heirloom-fp-v1"‖key)`, and app_id / instance_id / compose_hash / os_image_hash. **Functional check:** before each event a canary is sealed locally to the published pubkey, and after the event the TEE must open it. Code and raw results: `spike4-dstack-key/` (`results.json`). CVM `heirloom-keyprobe` (app `bb0619946fabbd72360c770088dcefd3947cc916`, tdx.small, prod5, centralized Phala KMS). Results:
  | Event | compose_hash | os_image_hash | pubkey | earlier canaries |
  |---|---|---|---|---|
  | baseline (v1, dstack-0.5.12) | 7d31dbf8… | 8db40cb2… | 6dc66091cf32… | — |
  | stop → start | same | same | **same** | 1/1 open |
  | `restartCvm` | same | same | **same** | 2/2 |
  | in-place compose update to v2 (**new code hash**) | 3428f833… | same | **same** | 4/4 |
  | in-place OS upgrade to dstack-0.6.1 (+ compose without pre-launch) | a57408ef… | ec43cb8c… | **same** | 5/5 |
  | **fresh CVM** `heirloom-keyprobe-2`, identical v2 compose (3428f833…) | same as v2 | 8db40cb2… | **different** (c75063b6…) | **0/6** ("incorrect key pair") |
  **Conclusion:** the key is a function of **app_id** (+ path/purpose), not of the code or OS. (a) Restart: survives. (b) Redeploy with a new code hash: **survives only as an in-place update of the same CVM**. A new CVM, which is what `shade deploy`/`deploy_new_cvm` always creates, gets a new app_id and a new key. §7.5 was rewritten around "provision once, upgrade in place". `instance_id` was also stable across all in-place events. `getKey` returned a 2-signature KMS chain each time (not yet verified).
- 2026-10-27 — [VERIFIED] **Centralized-KMS caveat:** the KMS releases the app key to whatever compose the Phala account holder commits in place. The shade contract's `approve_measurements` gates agent *registration* but not *key release*. So the developer (Phala account holder) could ship code that reads the sealed-notes key. This is recorded honestly in §7.5. Backlog: dstack on-chain KMS with a compose-hash allowlist + timelock.
- 2026-10-27 — [VERIFIED] **The CLI's embedded pre-launch script (Phala v0.0.14, `phala-cloud-prelaunch.sh`) breaks boot on dstack-0.6.1.** After `updateOsImage` to 0.6.1 the boot reached "requesting app keys" → "mounting data disk" → "pre-launch", then `boot.error: app-compose.service failed` within 90 ms. CVM status became `error` and nothing ran. Fix used: an in-place compose update with `pre_launch_script` removed; it then booted cleanly on 0.6.1. Day 1: either drop the pre-launch script (fine for public images) or take Phala's current one for 0.6.x, and remember it is part of the compose hash. Diagnose boot failures with `GET /api/v1/cvms/<uuid>/state` (boot_progress, boot_error, events) and `/events`. There are no serial-log endpoints.
- 2026-10-27 — [VERIFIED] **Phala in-place update behaviour:** `commitCvmComposeFileUpdate` reboots the CVM (about 60–70 s). For about 10 s after boot, `/Info` already reports the new compose hash while the **old container is still serving** before docker-compose recreates it. Health checks after an upgrade must check the app's own version string, not just the compose hash. A compose update committed while the CVM is stopped or in error also starts it. Spike 4 Phala cost: about 55 min (probe 1) + about 5 min (probe 2) of tdx.small ≈ **$0.06**. No NEAR, ETH or BTC was spent.
- 2026-10-27 — **Timing rule changed (human decision).** The human reports that the organizers confirmed in the official NearBuilders chat (Oct 27) that development may start before Nov 1, and that only submission is restricted to Nov 1–14. HACKATHON.md is consistent with this: it states start, deadline and submission dates but has no rule against earlier development. Rewrote §1.2 and hard rule 6: the repo may start now. Transparency rules kept: real commit dates, no backdating or history rewriting, template as first commit naming upstream, README states the real start dates, spike code not reused. To do: save the organizer's message (screenshot/link) in `docs/`, and re-check the live HACKATHON.md before submitting in case it changes.
- 2026-10-27 — **Timing restrictions removed (human decision; supersedes the previous entry).** The human reports that the organizers confirmed in the official NearBuilders chat (Oct 27) that development can start any time and that only submissions are limited to Nov 1–14. §1.2 now holds only the submission rules: submit Nov 1–14, repo public by 2026-11-14T23:59Z, one submission per team. Hard rule 6 removed. §11 item 9 changed from build provenance to credits (template + vendored licenses).
- 2026-10-27 — **Contract location:** the will lives in `agent-contract/src/will/` (`mod.rs` types/validation/transitions, `owner.rs`, `parties.rs` guardians/contacts/heirs/advance, `agent.rs`, `views.rs`, `events.rs`, `tests.rs`), inside the template's contract as decided. §4.1's `contract/src/{will,guardians,...}.rs` is superseded. The template's ungated `request_signature(path, payload, key_type)` (`your_functions.rs`) is **deleted**. The only signing entry point is the gated `request_signature(owner, chain, payload, purpose)`.
- 2026-10-27 — **Contract design choices beyond §5 (Day 1; change them if the human disagrees):** (1) **Guardians can't be heirs, the owner, or duplicates**, which enforces the threat model's "guardian independence". (2) **NEAR shares are on-chain** (`near_share_bps` per heir, sum 10000), because the contract pays NEAR itself. Foreign-chain shares stay in the off-chain policy and the agent applies them. (3) **`advance` moves one step per call** and returns whether it did, so every transition has its own event. (4) **Signing gate:** the contract builds the path `heirloom/<owner>/<chain>` itself, so the agent can't choose one. A release needs `Executing` with `stage ≤ current`, that (stage, chain) not yet marked done, and fewer than 16 signatures for it (enough for 1 EVM tx or up to 16 BTC inputs). A withdrawal needs `Active` plus a matching pending owner withdrawal on the same chain (cap 16). The payload must be 32 bytes of hex (Ecdsa, domain 0). (5) **Completion:** `Executing{last}` → `Completed` needs `stage_interval` elapsed **and** the agent to have called `mark_stage_done` for every (stage, foreign chain). If the agent never finishes, the will stays Executing, which is safe because the owner can still cancel. (6) **record_liveness** compares `at` to when the current state began. For Executing that's the execution start, so a signal during any stage halts. An older `at` only moves `last_alive_at` forward. A future `at` is rejected. (7) **Guardian `Alive` and `contact_confirm_alive` set `last_alive_at = now`.** Otherwise the next `advance` would go straight back to Quiet. (8) **`vote_failed` → Active keeps the old `last_alive_at`,** so the ladder restarts on the next advance. That's deliberate: the owner is still silent and we don't fake liveness. (9) **Owner calls while Active** (update, notes, withdrawals) refresh `last_alive_at`. `update_will`, notes and withdrawals are Active-only. **Deposits close** once execution starts. (10) **Execution rounds:** a halt keeps the records, and a later re-escalation starts round n+1 with a new NEAR snapshot. (11) **The last stage releases whatever is left** in the NEAR vault, so no rounding dust remains. A failed NEAR transfer is re-credited by the `on_near_transfer` callback. (12) **Storage:** the owner pays for create/update/notes, and the excess or freed bytes are refunded. Agent and guardian records (attestations, executions ≤ 200, released notes) are paid from the contract balance and bounded by caps. (13) **The agent's X25519 key** can be set once by a registered agent. After that only the contract owner can rotate it (§7.5).
- 2026-10-27 — **Known limitation (put this in THREAT_MODEL):** the contract can't see what a payload hash signs. So while a will is Executing, a compromised or buggy agent could get up to 16 vault signatures per (stage, chain) for arbitrary transactions. The gate limits *when* and *which vault*, not *what*. The defense is the attested TEE code plus the per-stage cap.
- 2026-10-27 — [VERIFIED] **Contract build:** `docker run … sourcescan/cargo-near:0.19.0-rust-1.86.0@sha256:7726…` with `cargo near build non-reproducible-wasm --locked --no-abi`, run as the host user (`-u $(id -u):$(id -g) -e HOME=/tmp -e CARGO_HOME=/tmp/cargo`). It needs no clang on the host and takes 4.5 min cold. The wasm is **907 KB, so about 9.1 NEAR of storage stake**. Unit tests run natively with `cargo +1.86.0 test --lib` (gcc is enough). Sandbox tests need that wasm at `target/near/shade_contract_template.wasm`.
- 2026-10-27 — [VERIFIED] **Template test changes:** the template's validity unit tests now call a test helper `template_request_signature`, which reproduces the old ungated call path from `require_valid_agent` + `internal_request_signature`. In `attestation_tests` the valid-agent case now expects "No will for this owner". `update_contract_tests` is `#[ignore]`d: its prebuilt fixture `contract_update.wasm` migrates the *template's* state layout, so it can't deserialize ours. **Any in-place upgrade of our deployed contract needs a `migrate()` written for our layout.** Until then, redeploy fresh, which is fine on testnet. The first run of `will_flow_tests` failed in parallel and then passed every run. The likely cause is the concurrent first-time download of the near-sandbox binary. Watch for it in CI.
- 2026-10-27 — [VERIFIED] **Day 1 ✅ on testnet.** Contract `inheirit.testnet` was deployed with `shade deploy` (local, `deploy_from_wasm`, funding 10.6 NEAR from `paid-outside.testnet`). The code hash `6VFWnx8sGKao7vtQHu1LWEHK879QcoyX6k256EB5MLno` matches the Docker build. Init: owner `paid-outside.testnet`, MPC `v1.signer-prod.testnet`, `requires_tee: false`, and the local default measurements/PPID approved. **The vault addresses derive from `inheirit.testnet`, so keep this name.** To fund the deploy, the old spike contract `heirloom-spike-7k3q.testnet` was deleted by the human (beneficiary `paid-outside.testnet`). `scripts/day1-walkthrough.mjs` uses throwaway demo accounts under `inheirit-demo.testnet` (created via the faucet helper `helper.nearprotocol.com`). Their keys are in `~/.config/inheirit/demo-accounts.json` (outside the repo, mode 600). **Will A** (`alice-9dy4j.inheirit-demo.testnet`) went Active → Quiet → WelfareCheck → GuardianVote → 2× Deceased → Challenge → Executing{0}. The heir received 0.4994 NEAR (50% of 1 NEAR minus the heir's own advance gas). Then `i_am_alive` gave Active, halted at stage 0, with 0.50 NEAR kept (tx `GVtzbVQsR5UpCiY6YiXnNSMGhw2K4HMG9KZjDX9s9Y9z`). **Will B** (`bob-9jdyg.inheirit-demo.testnet`) went the same way to Executing{0} → {1} → Completed, with the vault at 0 (tx `5K6SZfu4WEUDDUjkbK3h5uPUrTsfNjhc2h8pMhKcGDKr`).
- 2026-10-27 — [VERIFIED] **`rpc.testnet.near.org` is deprecated.** Mid-run it returned 429 with "THIS ENDPOINT IS DEPRECATED! … Switch to https://fastnear.com". Scripts default to `https://test.rpc.fastnear.com` (`NEAR_RPC_URL` overrides).
- 2026-10-27 — [VERIFIED] **Day 2 ✅ on testnet:** silence → guardians → staged release on NEAR, Sepolia and BTC testnet4 (links in §14). Agent layout follows the template, not §4.1: the agent is the repo root (`src/`), not `agent/`.
- 2026-10-27 — [VERIFIED] **A Sepolia ETH transfer is no longer always 21,000 gas.** The first value transfer to an empty account cost 207,391 gas (`eth_estimateGas`, reth 2.8.0), because of a new-account state surcharge. A transfer to an existing account is still 21,000. Our hardcoded 21,000 limit ran out of gas (status 0; only the fee was lost, and the nonce prevented a double send). Fix (`ee49bad`): estimate gas per recipient with a nonzero value (a zero-value call doesn't create the account) and add a 20% margin; drop a reverted pending tx so the next attempt signs at the next nonce. Fee reservation for the last stage now uses these estimates.
- 2026-10-27 — [VERIFIED] **mempool.space is partly unreachable from the home network:** only 1 of 8 IPv4 addresses (`103.165.192.202`) completes TCP; IPv6 is unreachable (known). The agent's BTC calls failed with "fetch failed" until `/etc/hosts` pinned that address. `mempool.emzy.de/testnet4/api` serves blocks but 404s on address/UTXO lookups, so it is not a fallback. Unlike chainsig's Mempool adapter, our executor treated each failure as an error and retried every tick, which worked as designed. The TEE deploy won't have this problem.
- 2026-10-27 — **Stage advance is time-gated only.** NEAR stage 1 paid out while ETH and BTC stage 0 were still failing; foreign chains caught up later, and Completed waited for every `mark_stage_done`. That's acceptable (the earlier stage still pays), but the UI must show per-chain progress, not just the stage number.
- 2026-10-27 — **Lesson: never delete an account that derives MPC vaults.** Deleting `heirloom-spike-7k3q.testnet` stranded about 0.06 Sepolia ETH at `0x7519…bbf9`; whoever re-registers that name controls it. Put this in THREAT_MODEL (contract account loss = vault loss) and never delete `inheirit.testnet`.
- 2026-10-27 — **`create_will` can't be reused by an owner whose will is Completed** (the record stays). Fine for the MVP; demo scripts use fresh owners. Backlog: archive or reset after Completed.

- 2026-10-27 — **One weak signal never counts (human decision).** §9 Scenario A's "simulate X post cancels" conflicted with §7.2. The human chose §7.2: a lone weak signal (X, Instagram, 0.4) does not count as alive in any state, including Challenge, because scheduled posts or someone else running the account must not block execution. The simulated sources exist to show which signals count: the demo first shows a lone X post being ignored, then cancels with the heartbeat or two weak sources within 24 h. §9 step 4 was rewritten.

- 2026-10-28 — **`inheirit.testnet` redeployed in TEE mode (human decision).** `requires_tee` is set only at `new` and has no setter, so a contract initialised in local mode never verifies attestations. `shade deploy` with `environment: TEE` cleaned the state in place (state-cleaner contract; the account was **not** deleted, so vault addresses are unchanged), then redeployed the same wasm (code hash `6VFW…MLno`). The first attempt failed at "Error topping up contract account: Transaction has expired" after the wipe; re-running found "no state to wipe" and finished. Measurement and PPID approval are disabled in `deployment.yaml` and done by `scripts/tee-agent.ts approve`. A separate local-mode contract is needed for local runs.
- 2026-10-28 — [VERIFIED] **TEE agent registered with a real attestation.** Flow: `docker build` → push `unwizarding/inheirit-agent:day2` (needs a user-level `docker login` with a Read & Write token; the earlier root login doesn't help non-sudo docker) → pin the digest in the compose → `tee-agent.ts provision` (the CLI's `deployToPhala` with dstack-0.5.12 and the CLI's default pre-launch script, which works on 0.5.12) → `approve` (measurements from the CVM's `tcb_info`; 20 of the 22 Phala PPIDs are valid). The agent's registration failed on PPID `62d54040…` until approve ran, then succeeded at 12:02:14 UTC on the next backoff retry. The OS measurements matched spike 1's 0.5.12 values (mrtd `7fe6…`, rtmr0-2 unchanged); only the compose hash differs. The executor state lives on the `agent-data` volume. Sponsor cost so far: about 0.73 NEAR (contract top-up + agent funding).
- 2026-10-28 — Docker Hub image is public (Phala must pull it). It holds the compiled agent and node_modules only; secrets come from Phala's encrypted env (`AGENT_CONTRACT_ID`, `SPONSOR_ACCOUNT_ID`, `SPONSOR_PRIVATE_KEY`, `DEMO_MODE`).
