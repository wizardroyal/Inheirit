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
   - **One scoped exception (v3, §9A):** NEAR Intents has no testnet, so its legs are shown on mainnet with small amounts. Only `scripts/mainnet-payout.ts` may do this. **Every mainnet transaction needs the human's explicit "yes" in chat, every time, after the script prints the origin asset/chain, amount, destination asset/chain, recipient, quote, fees and refund address.** Caps: ≤ $5 per transaction, ≤ $25 in total unless the human raises them. No Shade Agent and no contract on mainnet. A blanket "do everything" does not count as that yes. Read-only mainnet calls (dry quotes, views, address derivation) are fine.
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
**"A will that doesn't make you prove you're alive."** Use exactly this wording everywhere: README line 1, landing page, X post, video title.

It reads normal signs of life privately and only reaches out once you've gone quiet for longer than *your* normal. It never acts on silence alone, and it hands over assets across NEAR, Ethereum and Bitcoin in small reversible slices before it reveals any secret.

Core insights (the README states them explicitly):
1. **Passive liveness is safe only because of an asymmetry.** Signals can stop the will. Only people can start it: a guardian quorum plus a challenge period.
2. **The first release is the loudest alarm.** A 10% slice leaving the vaults, with heirs notified, is when a living owner notices. So the *longest wait* comes right after the first slice, and a false trigger costs at most that slice.
3. **Secrets come last.** Funds move in slices, but a revealed secret can never be un-revealed. So sealed notes are released only after distribution completes, plus a buffer.
4. **Private by construction.** The agent reads signals inside a TEE and only timestamps leave it. In-product AI uses only an attested NEAR AI Cloud model.

Originality note (for the README): inactivity-based tools exist, such as Google Inactive Account Manager and Bitcoin timelock wallets. What's new is the combination:
- many weighted sources, read privately in a TEE;
- a human escalation ladder before anything moves;
- cross-chain staged execution;
- secrets last.

### 2.2 The problem (from research on past attempts)
Billions in crypto are lost when holders die or become incapacitated. Past attempts (dead-man's-switch contracts, Bitcoin timelock wallets, multisig/social recovery, sealed letters) mostly solved the *transfer* and failed on the *humans*:
- **Check-in fatigue**: owners forget to prove they're alive; a lawyer never asks you to check in monthly.
- **False triggers**: hospital, retreat, lost phone.
- **Heirs** don't know assets exist, or can't claim them technically.
- **Single-chain**: Bitcoin-only or EVM-only tools.
- **No dry run**, wills go stale, no legal standing.
- **Seed phrases can't go in a legal will** (wills become public).

### 2.3 Design principles (non-negotiable — the whole pitch rests on these)
1. **Passive liveness, active escalation.** The agent watches normal activity in the background (**signals**). It reaches out (**checks**: heartbeat app, Telegram, email, DMs) only when silence lasts longer than the owner's normal plus a buffer (§7.1).
2. **Signals can stop it; only people can start it.** Any sign of life can delay or cancel. Silence alone can never trigger execution. Execution requires a quorum of *accepted* guardians plus a challenge period.
3. **Private by construction.** The liveness agent and sealed instructions run inside a TEE. Only timestamps leave the TEE, never content. In-product AI that touches will contents uses **NEAR AI Cloud** (TEE inference), never a non-private API.
4. **Staged and reversible as long as possible.** Release in slices, smallest first, with the longest wait right after the first slice (§5.5). Any sign of life between stages halts the rest.
5. **Secrets last.** Sealed notes are released per heir, and only after distribution completes and a buffer passes. A sign of life during the buffer means they are never released.
6. **Owner never loses control while alive.** The owner can withdraw from vaults and cancel at any stage.
7. **Consent and minimal data.** Guardians must accept their role before they count, and a will escalates only when it is "armed" (§5.5). Sign-up asks for a display name (jurisdiction optional) and nothing else: no date of birth, nationality or photo.
8. **Honest about limits.** The Shade Agent Framework is experimental and testnet-only. The vault model requires moving funds. Simulated signals are labelled. Heirs are hidden in the UI but readable on-chain.

### 2.4 Threat model (put a version of this in `docs/THREAT_MODEL.md` and the README)
| Attacker | Goal | Defenses |
|---|---|---|
| Greedy heir (± a colluding guardian) | Early access while the owner is alive | Only **accepted** guardians count. Guardian threshold and independence. Challenge period with loud owner notifications on every channel. Liveness veto. Staged release with the longest wait after the first slice. Secrets last |
| Lawyer (± a colluding heir) | Faster release through a false death proof | A death proof only shortens the remaining waits (accelerated schedule). It never skips the challenge period or a stage, and the guardian quorum is still needed to reach Challenge (§5.5) |
| Curious observer | Learn who inherits | Heirs are hidden in the UI, agent API and notifications until Executing. **Gap:** heir accounts and NEAR shares sit in contract state, which anyone can query. This is a documented limitation; backlog: commit-reveal of heirs |
| Outsider | Steal vault funds | Only the attested agent can request MPC signatures, and only while the will is `Executing`. Owner withdrawals are owner-signed |
| Platform / developer (us) | Read wills or sealed notes | Notes are encrypted to a TEE-held key, the agent code hash is approved on-chain, and attestation is shown in the UI. **Gap:** with Phala's centralized KMS, the Phala account holder can upgrade the CVM in place to code that gets the same key (§7.5). Mitigated by published compose hashes and the live compose hash in the UI. Backlog: on-chain KMS with a timelocked allowlist |
| Account hijacker after death | Keep posting or replying on Telegram to block heirs forever | Guardian liveness-override (supermajority + evidence), a backlog item |
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
| **NEAR Intents / 1Click** (v3, §9A) | Universal payout (each heir chooses the asset and chain they receive), stable-value inheritance, fund from anywhere. No testnet: the agent uses a SIMULATED 1Click client priced from the live token list; real mainnet legs only via an approval-gated local script | `src/intents/`, `scripts/mainnet-payout.ts`, `web/src/components/Payouts.tsx` |

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

> §5.1–§5.4 describe v1 as built. **§5.5 is the v2 target** and supersedes them where they differ.

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

### 5.5 v2 target
This section supersedes §5.1–§5.4 wherever they differ. The deployed code is still v1 until Day A lands.

**Flow:**
```
Active ──(armed, and silence > owner's normal + buffer)──▶ Quiet: CHECKS
   ▲        heartbeat app → email → Telegram → DMs (SIMULATED)
   │                         │ no reply
   │                         ▼
   │                 WelfareCheck: guardians → friends → lawyer
   │                         │ nobody confirms they're alive
   │                         ▼
   │                 GuardianVote (accepted guardians only)
   │                         │ quorum "deceased"
   │                         ▼
   │                 Challenge period (owner alerted on every channel)
   │                         │
   │                         ▼
   │        Executing: 10% ─(LONGEST wait)─ 20% ─ 30% ─ 40%
   │                         │ distribution complete
   │                         ▼
   │                 SecretsBuffer ──▶ SecretsReleased (per heir) ──▶ Completed
   │
   └── any valid sign of life at any stage before Completed → back to Active
       (partial execution recorded; remaining stages and unreleased secrets halted)
```

**Schedules** (every duration is configurable; the demo uses seconds):
| Schedule | Slices | Waits (demo) | Waits (real default) | When |
|---|---|---|---|---|
| Standard | 10 / 20 / 30 / 40 | 180 s, 60 s, 60 s, 60 s | 90 d, 30 d, 30 d, 30 d | default (about 6–7 months in total) |
| Accelerated | 10 / 30 / 60 | 60 s, 60 s, 60 s | 14 d, 14 d, 14 d | after a **death-proof attestation** |

- `wait_after` of stage n is the time from the start of stage n to the start of stage n+1.
- The last stage's `wait_after` is the time from the last slice to the start of SecretsBuffer. It also gives the foreign chains time to finish: SecretsBuffer needs every (stage, foreign chain) marked done, as Completed does in v1.
- `secrets_buffer` is 60 s in the demo and 30 d for real. The other timings stay as they are (`quiet_after`, `nudge_period`, `welfare_period`, `vote_period`, `challenge_period`). `stage_interval` is removed.
- The setup UI shows: "If you go quiet, the earliest anything moves is ≈ X; full distribution takes ≈ Y; secrets ≈ Z."

**Data model changes (`Will`):**
- `stages: Vec<Stage { pct: u8, wait_after: u64 }>` (standard) and `accelerated_stages: Vec<Stage>`. Each must sum to 100, with every pct > 0 and every wait > 0. They replace `stages_pct` and `timings.stage_interval`.
- `accelerated: bool`, set by a death proof and cleared on a return to Active.
- `guardians: Vec<Guardian { account, accepted: bool }>`. Guardians named at creation start as invited.
- `lawyer: Option<AccountId>`. The lawyer may also be a guardian, but never the owner or an heir.
- `heirs_hidden: bool`, default true. It applies to the UI, agent API and notifications only; the contract state stays readable (decision 2026-11-05).
- New states: `SecretsBuffer { since }` and `SecretsReleased { since }`, before `Completed { at }`.

**Methods (new or changed):**
- `invite_guardian(account)` / `remove_guardian(account)`: owner only, Active only. `accept_guardian(owner)` is called by the invited guardian.
- `is_armed(owner) -> { armed, missing: Vec<String> }`. A will is armed when accepted guardians ≥ threshold and it has at least 1 heir. An unarmed will never leaves Active: `advance` does nothing for it.
  - The "≥ 1 strong signal source" rule is checked off-chain by the agent and UI. The owner's own NEAR account always counts as one.
- `attest(...)`: accepted guardians only.
- `attest_death_proof(owner, evidence_hash)`:
  - Who: the lawyer alone, or the guardian quorum with evidence hashes on their attestations.
  - When: only in GuardianVote, Challenge or Executing.
  - Effect: sets `accelerated`. Before Executing, the whole schedule becomes the accelerated one. During Executing, the remaining stages keep their percentages and take the accelerated waits.
  - It never skips Challenge or a stage. A lawyer's proof during GuardianVote does **not** replace the guardian quorum.
  - It emits `death_proof_attested`.
  - No AI verdict can trigger it. AI may only pre-check a document and show its notes to humans.
- `contact_confirm_alive`: now also allowed for accepted guardians and the lawyer (the welfare chain), still only in Quiet/WelfareCheck.
- `store_released_note`: only in `SecretsReleased` (v1 allowed it in Executing | Completed).
- `i_am_alive` / `record_liveness` / guardian `Alive` in SecretsBuffer or SecretsReleased → Active. The distribution already sent stays recorded, and notes not yet released are halted.
- Events for every transition and role action: `guardian_invited`, `guardian_accepted`, `death_proof_attested`, `secrets_buffer_started`, `secrets_released`, and so on.

**Transition table changes** (on top of §5.3):
| From | Trigger | Guard | To |
|---|---|---|---|
| Active | advance | **armed** and now − last_alive_at ≥ quiet_after | Quiet |
| Executing{n} | advance | elapsed ≥ current schedule's `wait_after[n]` and n+1 < stages | Executing{n+1} (NEAR slice paid) |
| Executing{last} | advance | elapsed ≥ `wait_after[last]` and every (stage, foreign chain) done | SecretsBuffer |
| SecretsBuffer | advance | elapsed ≥ secrets_buffer | SecretsReleased |
| SecretsReleased | advance | every sealed note released (late heir key registration still works until then) | Completed |
| GuardianVote / Challenge / Executing | attest_death_proof | lawyer, or quorum with evidence | same state, `accelerated = true` |
| any pre-Completed (incl. SecretsBuffer, SecretsReleased) | i_am_alive / record_liveness(newer) | — | Active |
| Quiet / WelfareCheck | contact_confirm_alive | caller is a contact, an accepted guardian or the lawyer | Active |

**Tests to add (tests first):**
- every new transition;
- an unaccepted guardian cannot attest;
- an unarmed will never escalates;
- acceleration from each allowed role, and rejection from every other caller;
- acceleration never skips Challenge or a stage, mid-execution included (percentages still sum to 100);
- `store_released_note` rejected before `SecretsReleased`;
- a sign of life during `SecretsBuffer` halts the secrets;
- the partial execution record after an owner returns mid-execution;
- validation of the stage sums for both schedules.

**Deploy:** the storage layout changes, so `inheirit.testnet` gets a **fresh TEE-mode redeploy**.
- It uses the state cleaner on the same account, so the vault addresses don't change.
- Then run `tee-agent.ts approve`. The agent re-publishes the same sealed-notes key, because the key is unset after the wipe and the app_id is unchanged.
- Existing testnet wills are wiped, and so is the NEAR vault bookkeeping. Their foreign coins stay at the same derived addresses.
- Redeploy `inheirit-dev.testnet` the same way.

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
  | 'google_calendar' | 'gmail' | 'x' | 'instagram'
  | 'telegram' | 'tiktok' | 'facebook' | 'whatsapp' | 'linkedin';   // v2 additions

export interface SignalAdapter {
  source: SignalSource;
  simulated: boolean;              // MUST be true for simulated sources; surfaced in UI + README
  trustWeight: number;             // 0..1, how hard the signal is to fake (see table)
  /** Returns the most recent activity time for this owner, or null. Never returns content. */
  lastActivity(owner: OwnerSignalConfig): Promise<Date | null>;
}
```
| Source | Category | Layer | trustWeight | Hackathon status | Notes |
|---|---|---|---|---|---|
| near_onchain | on-chain | signal | 0.9 strong | **real** | Any tx signed by the owner's NEAR accounts (FastNEAR) |
| evm_onchain | on-chain | signal | 0.9 strong | **real** | The owner's personal Sepolia addresses (not the vaults) |
| phone_heartbeat | device | signal + check | 0.9 strong | **real** | `web/heartbeat` PWA: a signed ping on open, or an "I'm here" tap |
| github | work | signal | 0.5 weak | **real** | Public events API. Optional ("if you have it") |
| telegram | social/work | check (a reply is a signal) | 0.7 medium | **real, new (§7.7)** | Bot with long polling. Timestamps only |
| google_calendar / gmail | work | signal + check | 0.7 medium | simulated (real only if time remains) | OAuth in testing mode, tokens stay in the TEE |
| x / instagram / tiktok / facebook | social | signal + DM check | 0.4 weak | **simulated** | APIs paid or restricted |
| whatsapp | social | check | 0.4 weak | **simulated** | Business API too heavy |
| linkedin | work | signal | 0.4 weak | **simulated** | API closed |

Rules:
- A strong or medium signal (weight ≥ 0.7) counts alone. Weak signals count only when ≥ 2 different weak sources agree within 24 h; this is already built, keep it. "Medium" is the label for 0.7 (decision 2026-11-05).
- A reply to a check is itself a signal. A DM reply is weak (0.4), because the account may be managed or hijacked. A Telegram reply is medium (0.7). A heartbeat tap is strong (0.9).
- Every simulated source carries the `SIMULATED` tag in the UI, code and README. Work signals are optional and labelled "if you have them".
- **Removed from scope permanently:** last-known-workplace outreach and employee directories. They are intrusive, can harm a living owner, and carry data-protection risk. An owner who wants a colleague involved adds them by name as a friend contact.

Simulated adapters read from a local store the demo panel writes to (`POST /demo/signal {source, at}`), and are tagged `SIMULATED` everywhere.

### 7.2 Liveness scoring
- Poll all adapters every N seconds (demo: 15s).
- A signal counts as "alive" if its weight ≥ 0.7 (strong or medium, §7.1) **or** several weaker signals agree within a window. Rationale: social posts can be scheduled or run by someone else; signed on-chain txs and phone heartbeats are hard to fake.
- When the score says alive at time T newer than the contract's `last_alive_at`, call `record_liveness(owner, T)`.
- **Baseline** (v2: display only): the median gap between strong signals over the last 90 days, taken from the NEAR tx history the adapter already fetches and shown in words: "usually active every N days". Plain statistics, no AI. The contract's `quiet_after` stays a fixed owner setting; an adaptive `quiet_after` is backlog.
- **Privacy rule:** adapters return timestamps only. Never log, store, or transmit content.

### 7.3 Escalation driver, checks and notifications
- Each tick: read the state. If a period has elapsed and the will is armed, call `advance(owner)`. On each new state, notify:
  - Quiet → **checks**, spaced across `nudge_period`: heartbeat app → email → Telegram → SIMULATED DMs. Each attempt is logged as an event (channel and time, no content). The Telegram text is: "We haven't seen activity from you for a while. Reply anything (or open the heartbeat app) and nothing else happens."
  - WelfareCheck → guardians, then friends (contacts), then the lawyer: "Have you heard from <name> recently? Confirm they're fine: <link>". Telegram is used for anyone who linked it.
  - GuardianVote → accepted guardians: an attest link with what's known.
  - Challenge → the owner on **every** channel: "Your will executes in X. Any activity cancels it."
  - Executing / SecretsBuffer / SecretsReleased → heirs. Heir identities are used in notifications only from this point on.
- **One notification record per event**, with the list of channels and recipients it went to. This fixes the duplicate cards caused by the per-recipient fan-out in `src/escalation/driver.ts` `notificationsFor`.
- Email: no sender exists (the cut line was taken in v1). Email shows up as a channel in the UI log. Resend is optional if time remains and the human supplies `RESEND_API_KEY`.
- Known noise: an expired guardian vote returns the will to Active with the old `last_alive_at`, so with demo timings the ladder restarts about every 7 min. Grouped records and the human-language timeline keep this readable. Telegram sends the check, WelfareCheck and GuardianVote messages only once per silence (keyed by `last_alive_at`, `telegramSent` in the store); repeats are recorded in the app only. Challenge, Executing and SecretsReleased always go out.

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
- **v2: secrets last.** Once the will reaches `SecretsReleased` (distribution complete + `secrets_buffer`, §5.5), the agent decrypts inside the TEE and re-seals each note to its heir's pubkey (`store_released_note`, which the contract allows only in `SecretsReleased`). The heir decrypts in the browser. (v1 released notes from the moment execution started.)
- **Disaster recovery (not the normal path):** if the CVM or its app_id is lost (deleted, Phala account problem, KMS change), the old key is gone. Then the owner re-seals: a new agent publishes a new key through owner-approved rotation, and the web app flags notes sealed to the old key and asks the owner to re-encrypt them. Document this as a known limitation.
- **Honest trust note (README §7 and THREAT_MODEL):** we use Phala's **centralized KMS** (`kms_type: phala`), so whoever controls the Phala account can push a new compose in place, and that code would get the **same key**. Approving measurements on the agent contract does not stop it, because the KMS doesn't consult our contract. So "the developer can't read notes" rests on our operational discipline plus Phala's KMS, not on cryptography alone. Mitigations: publish every compose hash we deploy, keep public logs on, and show the live compose hash next to the approved measurements in the UI. Backlog: move to dstack's **on-chain KMS** (DstackApp contract with a compose-hash allowlist behind a timelock or multisig), which makes upgrades public and delayed.
- Also verify the KMS signature chain that `getKey` returns (2 signatures, proving the key belongs to this app_id under the KMS root in `key_provider_info`) in the attestation panel (Day 3, nice-to-have).
- UI guidance for owners: don't store a complete secret in one note (e.g. split seed phrase and passphrase); location/instructions notes are often safer and just as useful.

### 7.6 AI layer (NEAR AI Cloud only, because it handles will contents)
- Client: `openai` SDK with `baseURL: https://cloud-api.near.ai/v1`, key from env. Choose a capable model from `/v1/models` [VERIFY]; record the choice in the Decision log.
- **Policy parser:** plain-English will → JSON matching the schema below. Validate with zod. Deterministic checks after the model: shares per asset sum to 100%, every heir referenced exists, stages sum to 100%. On failure, show errors; never auto-fix silently. The owner must approve a human-readable summary before `policy_hash` is set.
- **Heir claim guide:** a chat that explains, in plain language, what's happening and what to click next. Fed only the heir's own claim info.
- **Attestation badge:** fetch `/v1/attestation/report` with a fresh nonce, verify per the example repo, show "Verified private inference" with details in a popover. Also show the agent's approved code hash from the contract.
- **Startup guard:** at boot, verify the attestation for `NEARAI_MODEL` and log the result, and refuse will contents while it fails. Today only the lazy `AttestationGate.require()` runs, before each AI call (`src/ai/attestation.ts`); the boot check is Day B work.

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

### 7.7 Telegram check (real)
- **Bot:** created by the human via BotFather. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` go in `.env` and in the TEE's allowed envs. A new key means `tee-agent.ts env` + `approve` (§14).
- **Linking:** the owner (or a guardian or friend) opens `https://t.me/<bot>?start=<one-time-token>` from onboarding. The token is issued on an owner-signed request (NEP-413), is single-use and short-lived, and is kept in the agent store. The agent maps chat_id ↔ account.
- **Long polling (`getUpdates`), not webhooks:** it only makes outbound calls, so it fits the TEE, which has no inbound webhook route.
- **A reply counts as a signal:** any message from a linked owner chat becomes a `telegram` observation at receive time, then goes through scoring (0.7) and on to `record_liveness`. Only the timestamp is kept; message text is never logged or stored.
- **Guardians and friends:** the same bot messages linked guardians and friends during WelfareCheck and GuardianVote. Cut line 4: owner only.

### 7.8 Plain-English liveness verdict
- Deterministic text (no LLM), recomputed every tick and returned by the agent API. Examples:
  - "Alive. Last strong signal: NEAR transaction 10 minutes ago."
  - "One X post seen; ignored on its own because posts can be scheduled or run by someone else."
  - "Quiet for 9 days. Alice usually transacts every 2 days — this is unusual for her. Checks started."
- `scoreAlive` (`src/liveness/score.ts`) returns only `{at, basis}` today. Extend it to also report the observations it ignored, and why.

---

## 8. Web app (v2)

Pages:
- These all exist today: `/`, `/owner`, `/guardian/[owner]`, `/heir/[owner]`, `/contact/[owner]`, `/demo`, `/heartbeat`.
- New: guardian invite/accept.

1. **Hero "Signs of life" panel** at the top of `/owner` and `/demo`:
   - One live strip per source that pulses when a signal lands, with a strength tag (strong/medium/weak) and a SIMULATED tag where it applies.
   - The ladder as a **horizontal** progress bar, showing the current step and a countdown to the next.
   - When a sign of life lands, the ladder visibly **snaps back to Active** with an animation. This is the demo's 3-second moment.
   - The plain-English verdict (§7.8) underneath.
   - A privacy strip: "What the agent saw: timestamps only", plus the attestation badges (TEE agent measurements and NEAR AI model).
2. **Human-language timeline:** "Alice went quiet", "Checks sent (heartbeat, email, Telegram)", "Friends asked", "Guardians voted", "Will executing: 10% sent". Raw state names appear only in an expandable "technical" view.
3. **Progressive onboarding:**
   - **Minimum will in 3 steps:**
     1. Signals: one wallet address plus the heartbeat app.
     2. Cast: one heir plus two guardians (invites sent).
     3. Vault deposit, with a **live allocation preview** ("2.1 ETH + 0.03 BTC → Ada; 0.9 ETH → Tobi").
   - **Will-strength checklist and score** afterwards: more signals, alert channels (Telegram, email), a lawyer, friends, final secrets, the heirs-hidden setting, a death-proof contact. It shows which items make the will "armed".
   - **Minimal sign-up:** display name required, jurisdiction optional. Both are stored in the off-chain policy (hashed), not on-chain. No date of birth, nationality or photo.
   - **Will entry:** either plain English (NEAR AI → JSON → human summary → approve) or a structured form. Percentages, not amounts.
4. **Final secrets step** (optional, skippable):
   - Guidance: "Prefer instructions (where the Ledger is, which drawer, who has the passphrase) over raw keys. Split secrets — e.g. seed phrase here, passphrase with your lawyer."
   - Shown clearly: "Released last, per heir, only after distribution completes and a 30-day buffer passes."
5. **Guardian invite/accept page**, and a **heir view that respects `heirs_hidden`**. No list of heirs is suggested to visitors (`/heir/[owner]` does this today).
6. **Setup summary:** "If you go quiet: earliest anything moves ≈ X; full distribution ≈ Y; secrets ≈ Z."

Design: calm, trustworthy, not "crypto-bro". Plain language everywhere; technical details go in expandable panels.

v1 as of 2026-11-05, the starting point:
- A vertical ladder (`web/src/components/Ladder.tsx`) with one countdown and no animation.
- `SignalList` (`web/src/components/WillParts.tsx`) with strong/weak and SIMULATED tags.
- Raw state names in the demo event log.
- One notification card per recipient.
- No sign-up data, no allocation preview, no duration summary.

---

## 9. Demo scenarios (the acceptance tests, v2)

**Scenario A — "Silence doesn't kill you" (cancel):**
1. An armed demo will (guardians accepted) with vaults funded on NEAR, Sepolia and BTC testnet, and the owner's Telegram linked.
2. Normal life: signals pulse and the verdict says "Alive". Stop all signals → Quiet: checks go out, and a Telegram message arrives on a real phone.
3. A lone SIMULATED X post is shown **not** cancelling, and the verdict explains why.
4. The owner replies on Telegram (or taps the heartbeat app, or two weak sources fire within 24 h) → **the ladder snaps back to Active**, the verdict explains why, and no funds move.
   - Variant: let it reach GuardianVote → 2 guardians attest → Challenge → a sign of life then cancels.
5. An unarmed will (a guardian hasn't accepted) never leaves Active.

**Scenario B — "It actually executes" (release):**
1. Same, but with no sign of life: quorum → Challenge → Executing.
2. Stage 1 (10%) lands on NEAR, Sepolia and BTC testnet, with explorer links → the **longest wait** (180 s in the demo) → 20% / 30% / 40% → SecretsBuffer → SecretsReleased.
3. The heir opens the claim page and registers a key (at any time before). The sealed note ("The Ledger is in the blue folder in the study…") decrypts only after SecretsReleased.
4. Variants:
   - The owner returns mid-execution → the remaining stages and the secrets halt, and the partial execution is recorded.
   - The owner returns during SecretsBuffer → the secrets are never released.
   - A lawyer's death proof → the remaining waits switch to accelerated, and the challenge period is not skipped.

Scripts: `scripts/demo-cancel.ts` and `scripts/demo-execute.ts` run both headlessly; the README links them. They need updating for v2: accept guardians, stage waits, the secrets stage, acceleration.


---

## 9A. NEAR Intents (v3): payout, stable value, fund from anywhere

> Merged 2026-11-06 from the human's `CLAUDE-update-v3-intents.md`. Reconciliation and live findings are in the Decision log (2026-11-06).

### 9A.1 The story (README wording)
**"Your heirs receive what they actually use."** Each heir chooses the asset and chain they receive (e.g. USDC on Base, SOL on Solana, NEAR). Owners can choose **stable-value inheritance**, which converts slices to stablecoins as they are released, so heirs aren't exposed to volatility during a months-long staged release. Owners can **fund their will from anywhere**. All three run on **NEAR Intents (1Click)**. It is a "universal checkout" turned into a **universal payout**, and it fixes a real failure of past crypto wills: heirs who can't claim because they lack the right wallet.

### 9A.2 How it fits the testnet core (reconciliation)
- The vaults still pay each slice on testnet exactly as before (NEAR by the contract, Sepolia/BTC by the agent). The **payout layer** takes each released slice (one execution record per round, stage, chain and heir) and sends it on through 1Click to the heir's choice. On testnet this onward leg runs on the **SIMULATED 1Click client** (real live prices from the public `/v0/tokens`, a fake deposit address, status PENDING_DEPOSIT → PROCESSING → SUCCESS), labelled SIMULATED everywhere.
- **Not done (would need contract changes):** holding a slice *in the vault* until the heir chooses. NEAR slices are paid by the contract in `advance()`. Instead the *onward payout* waits ("awaiting heir"), and the slices pay out together when the heir chooses. Documented.
- The agent never moves mainnet value and has no 1Click key; no new TEE env keys.
- Real mainnet legs: `scripts/mainnet-payout.ts`, run by the human (§9A.6).

### 9A.3 1Click flow (field names [VERIFIED] against the live OpenAPI spec, 2026-11-06)
Base `https://1click.chaindefuser.com`, header **`X-API-Key: $ONECLICK_JWT`** (the spec's recommended scheme; `Authorization: Bearer` is legacy). Code: `src/intents/oneclick.ts`.
1. `GET /v0/tokens` → `{assetId, decimals, blockchain, symbol, price, …}`; cached 10 min. Asset IDs are never hand-typed.
2. `POST /v0/quote`: `dry`, `swapType: EXACT_INPUT`, `slippageTolerance: 100` (bps), `originAsset`, `depositType: ORIGIN_CHAIN`, `destinationAsset`, `amount` (origin smallest units), `refundTo`, `refundType: ORIGIN_CHAIN`, `recipient`, `recipientType: DESTINATION_CHAIN`, `deadline` (+1 h), **`quoteWaitingTimeMs: 5000` always**, optional `confidentiality: basic|advanced`. The response `quote` has `depositAddress` (non-dry only), `amountOut(Formatted|Usd)`, `minAmountOut`, `deadline`, `timeEstimate`, `withdrawFee`, `refundFee`.
3. Send `amount` to `depositAddress` on the origin chain; `POST /v0/deposit/submit {txHash, depositAddress}`.
4. `GET /v0/status?depositAddress=` → `KNOWN_DEPOSIT_TX | PENDING_DEPOSIT | INCOMPLETE_DEPOSIT | PROCESSING | SUCCESS | REFUNDED | FAILED` (the v3 file did not list `KNOWN_DEPOSIT_TX`), with `swapDetails.originChainTxHashes / destinationChainTxHashes [{hash, explorerUrl}]`, `refundReason`.

Rules (`src/intents/payout.ts`):
- **Idempotency:** one deposit address per batch; the deposit tx hash is saved before anything else, so a batch is never deposited twice. REFUNDED/FAILED frees its slices for a new batch, at most 3 batches per slice ("needs attention" after that).
- **Minimum:** batches below **$1** wait for more slices; once the release is over (state no longer Executing) the rest goes out regardless.
- **Same asset and chain as the vault:** `mode: direct`, no 1Click.
- **"Quoting for this pair is not available"** (`NoRouteError`): the batch shows "waiting for a route" and retries with backoff (30 s, 60 s, 120 s, then every 5 min). It never fails or skips the slice.
- **Route probe:** an heir's choice is accepted only if a dry quote (≈ $10 from the NEAR vault asset) succeeds.
- **Expired quote before deposit:** dropped and re-quoted.

### 9A.4 Feature 1: universal payout
- An heir's **payout preference** `{blockchain, assetId, address}` is set by the heir on `/heir/[owner]`, signed by the heir (NEP-413 action `payout_pref`), and validated against `/v0/tokens` and the chain's address format. Offered chains: NEAR, Ethereum, Base, Arbitrum, Optimism, Polygon, Solana, Bitcoin; symbols USDC, USDT, wNEAR, ETH, BTC, SOL, POL.
- **Owner presets** for an heir's payout (v3 "optional") are **not built**.
- Heirs hidden: `GET /api/payouts/:owner` reveals nothing until a slice has been released. Before that, the heir's browser remembers its own choice.
- The heir page and the owner/demo panels show per-batch status, amounts and explorer links.

### 9A.5 Feature 2: stable value · Feature 3: fund from anywhere
- Policy field **`payout_value_mode: "as_is" | "stable"`** (optional, so existing policy hashes don't change). In stable mode, the destination is USDC on the heir's chosen chain, else USDT. If that chain has neither, the payout uses the heir's asset and the record says so. The policy parser recognises "in dollars / stablecoins / USDC". Setup and demo have a checkbox.
- **Fund from anywhere:** owner/demo panel → pick an origin token → quote into the will's vault → deposit address and expected amount. The user sends from their own wallet. SIMULATED on testnet (no coins arrive; the demo faucet still funds testnet vaults). The real flow is `mainnet-payout.ts fund` into the mainnet demo vault.

### 9A.6 Mainnet demo (honest and minimal)
- **Demo vault:** a **Chain Signatures-derived Base address** from a NEAR mainnet account the human holds (`MAINNET_DEMO_ACCOUNT` + `MAINNET_DEMO_PRIVATE_KEY`, path `inheirit/demo/base`), signed by `v1.signer` (mainnet). **Fallback:** a plain EVM key (`MAINNET_DEMO_EVM_KEY`). It holds ~$25 USDC on Base plus a little ETH on Base for gas.
- **Not yet available:** the human hasn't created the mainnet account. Derivation is checked: with a placeholder account the script derived an address via the mainnet MPC key.
- `scripts/mainnet-payout.ts`:
  - read-only: `vault | tokens | quote | status`;
  - moves value: **`pay`**, which enforces the caps, takes a fresh non-dry quote, prints every field, waits for a typed `yes`, sends USDC to the deposit address, submits the tx, polls the status, then records the payout in `web/src/data/mainnet-payouts.json` (shown in the app as "On mainnet") and the ledger in `~/.config/inheirit/mainnet-ledger.json`;
  - `fund`: prints a deposit address for the human's own wallet and sends nothing.
- **[VERIFY] the mainnet `sign` deposit:** the script attaches 1 yocto, like testnet (`MAINNET_SIGN_DEPOSIT_YOCTO` overrides).
- README wording: "Core runs on NEAR testnet. NEAR Intents has no testnet, so payout and funding via Intents are demonstrated on mainnet with small real amounts from a demo vault signed by a local script. In production, the attested agent's mainnet contract would sign these legs."

### 9A.7 Tests
- `test/intents.test.ts`: quote building; formatting; stable selection with the USDT fallback; address/asset checks; SIMULATED status walk; slice mapping; mixed heirs with one choosing late; no double deposit; stable conversion; no stablecoin on chain; direct transfer; minimum accumulation; no-route backoff; refund cap; failed send; and the API (signed choice, privacy before release, fund-from-anywhere, tokens).
- Hosted headless check: `scripts/demo-payout.ts`.
- **Mainnet checks** (human-approved, within the caps): one universal payout, one stable payout, one fund-from-anywhere deposit, each recorded in `docs/DEMO.md`.

### 9A.8 Feature 4: Confidential Intents (gated)
Start only after features 1–3 pass §9A.7 **including the mainnet checks**, and only without hurting the Nov 9–10 break/audit work. **Hard stop: Nov 11 end of day.** Otherwise it goes to the roadmap.
- A dry quote with `confidentiality: basic` and `advanced` succeeded on Base USDC → Arbitrum USDC on 2026-11-06 (same price as public).
- Use only that field on a normal ORIGIN_CHAIN → DESTINATION_CHAIN quote; not the `CONFIDENTIAL_INTENTS` deposit types.
- UI copy, only after reading what each mode hides: "Observers can't link your will's release to your heir's receipt." Never "invisible" or "anonymous".

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
TELEGRAM_BOT_TOKEN=          # BotFather; never commit
TELEGRAM_BOT_USERNAME=       # for t.me/<bot>?start=<token> links
DEMO_MODE=true
# NEAR Intents (§9A). The agent needs none of these; they are for scripts/mainnet-payout.ts.
ONECLICK_BASE_URL=https://1click.chaindefuser.com
ONECLICK_JWT=                # Partner Portal key (a JWT), sent as X-API-Key; never commit
MAINNET_DEMO_ACCOUNT=        # NEAR mainnet account whose key the human holds (derives the Base vault)
MAINNET_DEMO_PRIVATE_KEY=    # never commit
MAINNET_DEMO_DERIVATION_PATH=inheirit/demo/base
MAINNET_DEMO_EVM_KEY=        # fallback vault: a plain EVM key; never commit
BASE_RPC_URL=
INTENTS_MAX_USD_PER_TX=5     # raise only with the human's approval
INTENTS_MAX_USD_TOTAL=25
```

---

## 11. README requirements (judge-facing; AI judges read it)
1. Line 1 is the pitch (§2.1). Then what it is (2–3 sentences), the four insights and the originality note (§2.1), and the problem (with the "why past attempts failed" table).
2. **Try it in 5 minutes:** numbered "do X → see Y" steps on testnet using `/demo`, no real money.
3. How it works: the ladder diagram, the two principles (passive liveness; signals stop it, only people start it); signals vs checks; staged release with the long first wait; secrets last.
4. NEAR tech used and where in the code (table from §3).
5. Privacy: what runs in the TEE, what leaves it (timestamps only), attestation.
6. Threat model.
7. Honest limitations: Shade Agent Framework is experimental/testnet-only; vault model; simulated signals (listed); `conditions` not enforced yet; key persistence approach; heirs hidden in the UI only (contract state is readable); email notifications shown in the UI only.
8. Roadmap (§13).
9. Credits: Shade Agent template (upstream link) and vendored code with its licenses; built with Claude Code.

---

## 12. Build plan (v2)

> **Done before v2:** the Phase 0 spikes (Oct 27) and v1 build days 1–5 (Oct 27 – Nov 5): contract, agent, AI + sealed notes + attestation, web, and the hosted demo with Scenario B reaching Completed on 3 chains. Details are in the Decision log.

### Day A — Nov 5 (runs into Nov 6): contract + Telegram
- Contract §5.5, tests first.
- Fresh TEE-mode redeploy of `inheirit.testnet` and `inheirit-dev.testnet`.
- Update the agent, web and script bindings. Every user of `stages_pct` / `stage_interval` is listed in the Decision log 2026-11-05.
- Telegram bot (§7.7): link flow, the Quiet check message, a reply → medium signal.
- Ship **one** agent image that also carries the pending day6 fixes (`66758d5`, `3f3433b`) and the `TELEGRAM_*` env keys.
- ✅ CLI:
  - An unarmed will never escalates.
  - An armed will goes Quiet → a Telegram message arrives on the human's phone → a reply → back to Active.
  - A full run reaches `SecretsReleased` only after distribution plus the buffer.
  - Acceleration via the lawyer works and doesn't skip the challenge period.

### Day B — Nov 6: the killer feature made visible
- Hero signs-of-life panel, snap-back animation, plain-English verdict, privacy strip, human-language timeline, grouped notifications.
- Startup attestation check for `NEARAI_MODEL` (§7.6).
- ✅ In the browser: stop the signals → watch the ladder climb with countdowns → reply on Telegram (or tap heartbeat) → the ladder snaps back, with the verdict explaining why.

### Day C — Nov 7: onboarding + secrets + end-to-end
- Progressive onboarding: 3-step minimum will, strength checklist, allocation preview, minimal sign-up.
- Guardian accept page, final secrets step, heirs-hidden handling, setup summary.
- Update the demo scripts (`demo-cancel`, `demo-execute`) for the v2 flow, including the secrets stage and acceleration.
- Test the **heir claim on the hosted app** (register key → sealed note decrypts → AI guide). It was skipped on 2026-11-05.
- ✅ A new user creates a minimum will in under 3 minutes, and both demo scenarios pass end-to-end in the browser and headlessly.

### Cut lines (in order, if Days A–C slip)
1. Heirs hidden at contract level → UI-only hiding plus a documented limitation. **Already taken** (decision 2026-11-05).
2. Accelerated schedule UI → contract + CLI only.
3. Will-strength *score* → a checklist without the score.
4. Telegram for guardians → owner only.

**Never cut:** the snap-back moment, the Telegram owner check, standard staging with a long first wait, secrets-last gating.

### Nov 8–14 — improve, test, break, audit
- **Nov 8, Intents day (v3, §9A):**
  - **Built ahead on 2026-11-06:** the 1Click client (real + SIMULATED), features 1–3, the heir payout step, the stable-mode setting, fund from anywhere, `scripts/mainnet-payout.ts` and `scripts/demo-payout.ts`.
  - **Left for the human (each transaction needs a "yes"):** create the NEAR mainnet account and fund the Base vault (~$25 USDC + a little ETH), then run one payout, one stable payout and one funding deposit.
  - ✅ When the SIMULATED Scenario B passes with mixed heir choices, three mainnet tx links are in `docs/DEMO.md`, and the app shows a mainnet slice arriving.
  - Cut order: (1) Chain Signatures mainnet origin → the plain EVM key fallback; (2) the real mainnet funding deposit → SIMULATED + UI only. Never cut universal payout.
- **Nov 9, break it** (first pass done 2026-11-06, see the Decision log; a second pass can follow): adversarial testing session(s). Each finding becomes a test, then a fix. Cover:
  - greedy-heir scenarios and a colluding guardian;
  - replayed or forged signals, and simulated-signal spam;
  - signing a payload outside `Executing`, and double execution;
  - an early `store_released_note`;
  - an agent restart mid-execution;
  - Bitcoin UTXO and fee edge cases;
  - empty or partly funded vaults;
  - Intents: double-send attempts, the refund path, expired quotes, cap enforcement, wrong-chain addresses, an heir's choice set by someone else.
- **Nov 10, audit:** a fresh Claude Code session with no prior context reviews the contract and agent against `docs/THREAT_MODEL.md` and this spec, and reports findings only. Fix what it finds. Also confirm the Intel TDX check (nearai-cloud-verifier) still passes before showing the "verified" badge.
- **Nov 11, polish** (plus Confidential Intents §9A.8 only if its gate is met; hard stop end of day):
  - Copy, empty states, mobile layout, performance.
  - README per §11: the pitch, the insights from §2.1, "do X → see Y", the list of simulated sources, limitations, roadmap.
  - Replace `<WEB_URL>` in `README.md` with `https://inheirit.vercel.app` and check "try it in 5 minutes" against the hosted app.
- **Nov 12, demo:** record the 90 s video (script below) and draft the X post for the human.
- **Nov 13:** buffer, final README pass, repo made public (the human approves).
- **Nov 13–14:** the human submits (never the agent). Aim to submit by Nov 13.

**Demo video script (~90 s):**
1. One line: "A will that doesn't make you prove you're alive."
2. Normal life: signals pulse, nothing happens; the verdict says "Alive."
3. Silence: the ladder climbs, a Telegram message arrives on a real phone, friends and guardians are asked.
4. The owner replies on Telegram → **the ladder snaps back** → the verdict explains why.
5. Replay without a reply: quorum → challenge → 10% lands on NEAR/Sepolia/BTC → "Ada chose USDC on Base — here it arrives" (the mainnet explorer link on screen) and one line on stable value → the long wait (fast-forwarded) → the remaining slices → buffer → the heir opens a sealed note.
6. Close on the privacy strip and "Built on NEAR: Chain Signatures, Shade Agents (TEE), NEAR AI Cloud."

---

## 13. Roadmap (README) and backlog
**Roadmap (README only, not built now):**
- a human adjudicator for disputes and heir support;
- real Gmail / Calendar / X / Instagram / WhatsApp / LinkedIn adapters;
- an adaptive baseline per source;
- incapacity mode (a caretaker allowance via function-call keys);
- fire-drill mode;
- stale-will review;
- a lawyer companion letter;
- gasless heir claims;
- **Private inheritance with Confidential Intents** (if not shipped by Nov 11): payouts that observers can't trace from the will's release to the heir's receipt.
- **Intents-native vault:** the will holds every asset as a NEAR Intents balance, distributes by internal transfer, and heirs withdraw to any chain. One vault for every asset, instant cross-chain payout; needs mainnet and production Shade Agents. Feasibility checked: a dry 1Click quote from a NEAR Intents balance (`depositType: INTENTS`) to USDC on Base succeeded on 2026-11-05.
- Self-funding upkeep (the agent pays its own inference and hosting via Intents) and automatic gas top-ups for vaults and heirs.
- Holding a slice in the vault (contract-level) until the heir chooses a payout.

**Engineering backlog (from v1, still open):**
- Hardening: guardian disagreement, partial vault funding, fee estimation, BTC UTXO edge cases, an idempotency audit.
- Guardian liveness-override (supermajority + evidence) for hijacked accounts.
- ERC-20 / test USDC vaults.
- Enforce `conditions` (e.g. not_before).
- Contract-level heir hiding (commit-reveal).
- Email via Resend.
- An adaptive `quiet_after` driven by the baseline.
- Archive or reset a will after Completed.
- Named-account onboarding for non-crypto heirs.

---

## 14. Status (update every session)
- **Phase:** v2 Day A (2026-11-05), code complete locally. The contract, agent, scripts and web app are on v2 (commits `6dd38ac`…`602506e`, branch `web-day4`, **not pushed**). The v2 contract is live on `inheirit.testnet`. The **TEE agent runs v2a** (registered on the v2 contract, same sealed-notes key, Telegram on). `main` has the v2 web app (`06e4e41`); the Day B web panel (`1ad60ca`) is not pushed yet. Local runs use `inheirit-dev2.testnet` (local mode, v2; `inheirit-dev.testnet` is v1 and stale) with a local agent on port 3002 (`DATA_DIR=./data-v2`). Hosted setup:
- **Last checkpoint:** ✅ 2026-11-05: Scenario B ran to **Completed on all three chains on the hosted app** (owner `alice.inheirit-kjgw3v.testnet`, details in the Decision log). Scenario A's cancel moment was also run by the human on the hosted app (guardian vote → Challenge → owner sign of life → Active). Tests: 126 vitest, agent typecheck clean, web typecheck clean.
- **TEE agent (provision once; never re-create, §7.5):** CVM `inheirit-agent`, vm `e3685437-e716-493a-ac4e-3717a72e7fdd`, **app_id `d5b714731becca502b6bd054a5cf6ffa5ce71f61`**, dstack-0.5.12, tdx.small, gateway `dstack-pha-prod9.phala.network`. Image `unwizarding/inheirit-agent@sha256:b86d5af598c9aec1561e61ab3576bdadca7cdb2ff0ae91337e37ffa32057f55d` (v2g: v2f + second-audit fixes), live compose hash `02cc55b90732eaa871b06521bd2a6991dfc8fe19e53462d6a3256576e1dc7b0c` (11 allowed_envs, incl. DEMO_FAUCET_*, NEAR_RPC_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME). It is the only approved hash on 2026-11-06; earlier hashes are retired. `NEAR_RPC_URL` in the TEE = keyed FastNEAR only (key sent as a bearer header). Agent account changes on every boot (implicit account); on 2026-11-06 ~13:22Z it is `4808c1099524a220e563914854e37b5f5f95bf6d0bfb44b7431ff6ddc3293750`. **Sealed-notes key on `inheirit.testnet`: `ae74cf06b6be6e3896aa9e9641f4d67e8a598db39724903cec7f1955c2ffa51e`** (app_id `d5b71473…`, from dstack in the TEE). API: `https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network`. Logs: `https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-8090.dstack-pha-prod9.phala.network/logs/shade-agent-app?text&bare&timestamps&tail=50`. Record in `deploy/tee-agent.json`; tool `scripts/tee-agent.ts provision|approve|upgrade|env|retire|status|stop|start` (needs the shade CLI keyring: Phala key + testnet account `paid-outside.testnet`; **the keyring is wiped on every WSL restart**, see Decision log 2026-11-05). It costs about $0.06/h while running; `stop` keeps the app_id and key.
- **Shipped in v2a (2026-11-05):** the faucet fixes (`66758d5`) and the transport-only RPC failover (`3f3433b`). It is now safe to set `NEAR_RPC_URL=https://test.rpc.fastnear.com?apiKey=…,https://near-testnet.drpc.org` and run `tee-agent.ts env` (no new hash, because the key list is unchanged). **Only one Telegram poller per bot token:** don't run a local agent with the Telegram keys while the TEE agent is up; unset them locally.
- **Sponsor budget:** every reboot (upgrade, env, stop/start) gives the agent a new implicit account that the **TEE sponsor `tee-sponsor.inheirit-fund-0am6d3.testnet`** funds with 0.5 NEAR (since v2g; `TEE_SPONSOR_*` in `.env`, sent to the CVM as `SPONSOR_*`). It has no key on the contract; `tee-agent.ts` refuses a sponsor key that is an access key on `inheirit.testnet`. Keep it at ≥ 1.5 NEAR; `tee-agent.ts upgrade|env|start` refuse to run below 1 NEAR. Top it up from a demo funder, never from `inheirit.testnet` (that balance holds wills' NEAR vaults). `paid-outside.testnet` (`SPONSOR_*` in `.env`) stays on the laptop only: contract owner, the contract account's full-access key, and the shade CLI's testnet account for `approve`/`retire`.
- **How to ship an agent change (the flow that worked on 2026-11-05):** (1) human: `docker build --platform linux/amd64 -t unwizarding/inheirit-agent:<tag> .` and `docker push …` (Docker Desktop with WSL integration on; trailing ` .` matters); (2) Claude: pin the pushed digest on the `image:` line of `docker-compose.yaml`; (3) make sure the keyring has both credentials (`tee-agent.ts status` works); (4) CVM must be **running** (`tee-agent.ts start` if not); (5) `tee-agent.ts upgrade` (approves the new hash before reboot); (6) only if `ENV_KEYS` in `scripts/tee-agent.ts` gained a key: `tee-agent.ts env` (retry while it says "Another operation is already in progress"), wait ~45 s, then `tee-agent.ts approve` **immediately** (the env update changes the compose hash; unapproved = registration fails and burns agent NEAR); (7) watch the logs for `Agent registered` after the newest `Agent account ID` line; (8) `tee-agent.ts retire <old hashes>`; append to `deploy/tee-agent.json`; commit. A pure value change in `.env` (same keys) is just `tee-agent.ts env`, no approve.
- **Next steps (in order):** (1) The human checks Vercel → Firewall (Attack Challenge Mode or bot protection; the Persistent Action from 2026-11-05 should expire) so that tools and AI judges can load `inheirit.vercel.app`. (2) Done: repeat Telegram messages after an expired vote go out once per silence (v2d). (2b) **NEAR Intents (§9A) built and live (SIMULATED, v2e).** The human: create a NEAR mainnet account, fund the Base demo vault, then approve each of the three mainnet checks one by one (`docs/DEMO.md`). Confidential Intents stays gated (§9A.8). (3) Done 2026-11-06: break-it pass and the second (fresh-context) audit, fixes live as v2g. (4) Nov 11 polish (mobile, empty states, copy), then Nov 12 the demo video script and X post draft for the human. Then the human makes the repo public, re-reads the live HACKATHON.md and submits.
- **Contracts:** `inheirit.testnet` = TEE mode (the real one; only the attested CVM agent). `inheirit-dev.testnet` = local mode for laptop runs (`scripts/deploy-dev-contract.ts`; self-owned throwaway demo key; its sealed-notes key is a LOCAL DEV key, not protected).
- **Blockers / open questions:** (1) `/api/owners` is no longer demo-only: signed requests work in any mode. (2) Local machine: mempool.space is **unreachable from the home network** (IPv6 down, all IPv4 addresses time out; the old `/etc/hosts` pin is gone), so check BTC through the TEE logs or the explorer in the browser. (3) Local agents on :3000/:3001 from October may still be running; stop whichever isn't needed. (4) Stranded test coins: 0.003 Sepolia ETH + 30,000 sats in the vaults of `alice.inheirit-4aqpxg.testnet` (keys lost; see Decision log). (5) In this Claude session the shell's `grep` was a broken wrapper; use `/usr/bin/grep` if `grep` prints "claude native binary not installed".

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
- 2026-10-28 — [VERIFIED] **Day 3 ✅ locally** (see §14). Design: the model only drafts; `checkPolicy` validates; the summary the owner approves is generated by code (`summarizePolicy`), not by the model, and errors are shown, never auto-fixed. Will text goes to NEAR AI only after `AttestationGate.require()` passes (fresh nonce, passing result cached 10 min, a failure is re-checked next time); a response is accepted only if its signature covers sha256 of our exact request and response bytes and recovers to an attested model signer. NEAR AI is called with plain fetch rather than the openai SDK, because verification needs the raw bytes.
- 2026-10-28 — [VERIFIED] **`@hono/node-server`'s `serve()` replaces the global `Request`/`Response` by default, which breaks dcap-qvl.** Its WASM fetch glue checks `instanceof Response`, so inside the agent every TDX quote check failed with "Failed to get collateral" while the same call passed in scripts. Bisected to `serve()`; fixed with `overrideGlobalObjects: false` (`0f735df`).
- 2026-10-28 — **Sealed notes:** in the TEE the key comes from dstack `getKey("heirloom/sealed-notes","x25519-v1")` + `crypto_box_seed_keypair` and stays in memory. Locally there is no TEE, so `data-dev/dev-sealed-seed.hex` holds a random dev seed (labelled LOCAL DEV, unprotected). At boot `ensureAgentKey` publishes the key once or, on a mismatch, disables sealed-note work and logs it loudly (seen in the day3 image smoke test: a fresh container derived a different dev key and refused). The releaser runs after the executor for Executing and Completed wills, skips heirs without a key, and logs a note it can't open once instead of retrying every tick.
- 2026-10-28 — **Dev contract** `inheirit-dev.testnet`: created through the faucet helper (10 NEAR), same wasm, local mode, owned by itself with a throwaway key in `~/.config/inheirit/demo-accounts.json`, approves the all-zero local measurements/PPID, and whitelists the local agent. About 0.85 NEAR is spare after storage.
- 2026-10-28 — Gotcha: a pasted `.env` line can carry the example placeholder (`NEARAI_API_KEY=...` gave 401 "Invalid or expired API key"). Checking key shape without printing it (length, prefix, placeholder) found it.
- 2026-10-29 — [VERIFIED] **Day 3 in the TEE.** In-place upgrade to the day3 image (same CVM, same app_id): the agent registered, derived the **same sealed-notes key** as before (`ae74cf06…`, matches `get_agent_pubkey`, `enabled: true`), and `GET /api/attestation/ai` from inside the CVM returned `ok: true` (both TDX quotes UpToDate, report_data binds signer + nonce, compose = mr_config, NVIDIA GPU, compose-manager hash).
- 2026-10-29 — [VERIFIED] **Phala `allowed_envs` gotcha.** A compose update (`provisionCvmComposeFileUpdate`/`commit`) keeps the CVM's existing `allowed_envs`, so new env keys (NEARAI_API_KEY, NEARAI_MODEL) were silently dropped (the agent logged "NEARAI_API_KEY not set"). `updateCvmEnvs` with the new key list changes `allowed_envs` in one step on the centralized KMS (`allowed_envs_changed: true`, no precondition) and restarts the CVM. That changes the compose hash, so run `tee-agent.ts approve` after it. Check `allowed_envs` on the `-8090` root page.
- 2026-10-29 — [VERIFIED] **Register funding drained before approval.** Boot funds the agent 0.5 NEAR once; failed `register_agent` attempts while the new compose hash was unapproved left 0.298 NEAR, below the ~0.306 a 300 Tgas call needs, and the loop never topped up again. Unblocked with a 0.2 NEAR transfer from `inheirit-demo.testnet`; fixed in `src/index.ts`: the register loop tops up 0.5 when the balance is below 0.35, at most 3 times. Order for future upgrades: approve the new hash promptly after the restart.
- 2026-10-29 — **Owner-signed requests are NEP-413** (`src/auth/nep413.ts`). The web app signs `{action, owner, issued_at, data}` addressed to the will contract (recipient = `AGENT_CONTRACT_ID`); the agent verifies the ed25519 signature, then `view_access_key` on-chain. A **full-access key** can do anything; a **function-call key whose receiver is the will contract** (a heartbeat device key) can only send heartbeats. Messages older than 5 min, from another account, or with a reused nonce are refused. `/api/owners` and `/api/policy/draft` accept signed requests in any mode (unsigned only in demo mode); `/api/heartbeat` and `/api/heir/guide` are never unsigned. [VERIFIED] `@near-js/signers` 2.5.1 doesn't export `Nep413MessageSchema` from its index, so the schema is defined locally; FastNEAR reports a missing access key inside `result.error` ("does not exist while viewing"), not as a JSON-RPC error.
- 2026-10-29 — **phone_heartbeat is real**: `POST /api/heartbeat` (signed) records server receive time; `HeartbeatAdapter` (0.9) scores it. `/api/signals/:owner` returns the latest time per source (merged across ticks, timestamps only) for the UI timeline.
- 2026-10-29 — **Heir claim guide** (`src/ai/heir-guide.ts`, `POST /api/heir/guide`): signed by the heir, refused (403) for non-heirs. The model gets only that heir's facts built by code (state, stages, their share and releases, key/notes counts; never note contents or other heirs). The answer is returned only if the chat signature recovers to an attested signer. [VERIFIED] live on `inheirit-dev.testnet` as `bola.inheirit-demo.testnet`: accurate answer in ~31 s, signer `0x3b75…fa0c`.
- 2026-10-29 — **Web app = Next.js 16.4.2 in `web/`** (App Router, Tailwind 4, React 19.3, npm with exact pins; create-next-app 16.4.2, two weeks old). `cacheComponents`/`partialPrefetching` from the scaffold removed: the pages are client dashboards over live chain state. `turbopack.root` is the repo root so `web/` imports `../src/policy/policy.ts` (`@agent/*` alias): validation, `policyHash` and the approval summary are the same code in browser and agent (`policyHash` now uses `@noble/hashes`, same output). Building `web/` therefore needs `npm ci` in the repo root too. Env: `NEXT_PUBLIC_AGENT_URL`, `NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_NEAR_RPC` (`web/.env.example`). The template's Vite `frontend/` is untouched (still the template's verification UI).
- 2026-10-29 — **Signing in the browser = keys held in localStorage, no wallet yet.** `/demo` creates a throwaway cast per browser: a top-level funder from the testnet faucet helper ([VERIFIED] `helper.nearprotocol.com/account` allows browser CORS), then `alice`/`bola`/`g1-3`/`friend` subaccounts. Real users can import a testnet key on `/owner`. NEAR Wallet Selector is backlog (NEP-413 `signMessage` is wallet-compatible, so the agent side won't change).
- 2026-10-29 — **UI bug found and fixed in the browser run:** the 4 s will poll swapped the setup view for the dashboard as soon as `create_will` landed, unmounting the rest of the flow (deposit, policy hand-off, agent registration, sealed note) so its errors were invisible. The setup view now stays until every step finishes, and dashboards show a warning + "ask the agent to watch" button when the agent isn't watching or lacks the policy.
- 2026-10-29 — **`scripts/fund-vaults.ts <owner>`** funds a will's Sepolia and BTC testnet4 vaults from the demo heir's recycled test coins (`heir-eth`/`heir-btc` in `~/.config/inheirit/demo-accounts.json`); execution pays the same heir addresses, so demo coins circulate. Defaults 0.003 ETH / 30,000 sats.
- 2026-10-29 — [VERIFIED] **Scenario A in a real browser** (headless Chromium driving `/demo`, local agent on `inheirit-dev.testnet`): cast in 18 s → will → GuardianVote at ~300 s → 2 guardians confirm → Challenge → a lone SIMULATED X post ignored (still Challenge after 40 s) → signed heartbeat → Active in 16 s; 0 executions, 1 NEAR untouched; no console errors. Test owner `alice.inheirit-c1i74s.testnet`.
- 2026-10-29 — Browser testing setup (local, not in the repo): Playwright 1.56.1 + `chromium-headless-shell`; WSL lacks `libnspr4`/`libnss3`/`libasound2t64` and there is no sudo, so they were `apt-get download`ed, extracted with `dpkg-deb -x`, and passed via `LD_LIBRARY_PATH`. The test harness must retry its own RPC polls and use a persistent browser profile: a harness crash on a FastNEAR connect timeout lost one cast's in-browser keys, stranding 0.003 Sepolia ETH + 30,000 sats in the vaults of owner `alice.inheirit-4aqpxg.testnet` (ETH `0xAC24…973C`, BTC `tb1qdp02…2spz`).
- 2026-10-29 — The human's local agent on port 3000 (old code, `data-dev/`) was left running (stopping it was not permitted). Web testing used a second agent on port 3001 with `DATA_DIR=./data-web` (fresh store, so it never drives the other agent's wills) and a copy of the local dev sealed-notes seed. Both share the same local agent NEAR account; no nonce clashes were seen.
- 2026-10-29 — [VERIFIED] **Day 4 ✅: Scenario B in a real browser** (`/demo` + `/heir`, local agent on `inheirit-dev.testnet`, owner `alice.inheirit-or2syc.testnet`): cast → will → vaults funded with `fund-vaults.ts` → heir registers a key in the browser → GuardianVote (~300 s) → 2 guardians confirm → Challenge → Executing; stage 1 landed on all three chains within ~50 s: 0.1 NEAR (contract transfer), 0.0003 Sepolia ETH (`0xaffad7c97928c0d01e4cc207ef920b43667bd527bda31f77fb0e9e2525753f82`), 3,000 sats testnet4 (`896f8be4dda56a6ace4788afd66aed5c215aa21dae5faf59601ba8b0c58c1c2e`). The heir decrypted "The Ledger is in the blue folder…" in the browser. The owner pressed "I'm alive" mid-execution → Active, halt recorded (`owner_alive`, stage 0), 0.9 NEAR kept. No page errors.
- 2026-10-29 — **Judging setup (human decision):** the web app will be **hosted publicly** (judges get a URL, not local setup), pointed at `inheirit.testnet` and the Phala TEE agent's public URL, and the **TEE agent CVM runs during judging** (at least through Nov 16–18; ~$0.06/h) so judges can run both scenarios themselves. Consequences for Day 5+: ship the Day 4 agent to the TEE before hosting; add rate limits on the NEAR AI routes (`/api/policy/draft`, `/api/heir/guide`) since free faucet accounts can sign; add a capped demo vault faucet so a judge's will can show Sepolia/BTC release without their own test coins; keep the sponsor account funded for agent gas. The deploy itself (host account, env vars, going live) is still done with the human, step by step.
- 2026-10-29 — **Rate limits** (`src/auth/rate-limit.ts`, in memory, fixed window, per signing account + global): drafting 6/h per account and 120/h total; heir guide 20/h and 300/h; demo faucet 1/day per owner and 20/day total. Free faucet accounts can sign, so signatures alone don't bound cost.
- 2026-10-29 — **Demo vault faucet** (`src/demo/faucet.ts`, `GET|POST /demo/faucet`): demo mode only, owner-signed, once per will (persisted in the store), only for Active wills, only into empty vaults; 0.002 Sepolia ETH + 20,000 sats by default. The pool keys (`DEMO_FAUCET_ETH_KEY`/`DEMO_FAUCET_BTC_KEY`) are the demo heir's testnet keys, and the web demo uses the pool's addresses as the heir's receive addresses, so released coins flow back to the pool. `fund-vaults.ts` reuses the same send code.
- 2026-10-29 — [VERIFIED] **FastNEAR rate-limits a busy agent.** With two local agents, browser polling and test scripts on one IP, the test agent logged 158 × 429 "Rate limits exceeded", stalling a Scenario B run in Challenge and killing a script. Root cause in our code: **demo wills were driven forever** (a failed vote returns a silent will to Active, so it cycles Quiet → … → Active indefinitely), each costing RPC calls and gas every 15 s. Fixes: in demo mode the driver drops a will from the watch list `DEMO_WATCH_HOURS` (default 3) after it started watching, never mid-execution (the UI's "ask the agent to watch" button resumes it); a 429 ends the current tick instead of hitting every remaining will; `NEAR_RPC_URL` accepts a comma-separated list (`FailoverRpcProvider`, passed to `ShadeClient` as `rpc`) and is in the TEE's allowed env so a keyed URL can be set during judging; `/api/status` and `/api/vaults` answers are shared for 5–15 s across pages. After the fixes: 0 × 429.
- 2026-10-29 — [VERIFIED] **Re-verified after the fixes** (local agent on `inheirit-dev.testnet` with the faucet on): browser Scenario B with the faucet, owner `alice.inheirit-qyqbfl.testnet`: the faucet funded both vaults during creation; stage 1 released 0.1 NEAR, 0.0002 ETH (`0x6194e4a9c7af1d39fe07347d90595e0ce73ad0cfcb188d8da30f79f159a6aaa5`) and 2,000 sats (`a260ee29254d3433b626726ffaafc0587dc7356ea2a693edfce2ad36c75148dd`) back to the pool; the heir decrypted the note; the owner's return halted the rest. Headless `scripts/demo-cancel.ts` (owner `dan.inheirit-fund-sp6ecr.testnet`): Challenge → lone X post ignored → signed heartbeat → Active in 10 s, vault untouched.
- 2026-10-29 — `inheirit-demo.testnet` (scripts' default funder) is down to ~0.13 NEAR. `scripts/new-funder.ts` creates a fresh faucet-funded funder (`DEMO_FUNDER_ACCOUNT=<id>`); today's is `inheirit-fund-sp6ecr.testnet`.
- 2026-10-29 — **README rewritten for judges** (§11) with a `<WEB_URL>` placeholder until the Vercel deploy; `docs/THREAT_MODEL.md`; `docs/DEPLOY.md` (the human's runbook for the TEE upgrade + Vercel). The Vercel install (`web/vercel.json`: `npm ci --prefix .. --ignore-scripts && npm ci`) was tested in a clean clone with npm 10.9.2: install and `next build` succeed. The agent image builds locally (`docker build --platform linux/amd64`); it was not pushed.
- 2026-11-05 — [VERIFIED] **Day 4 agent live in the TEE** (in-place upgrade, same app_id): registered 08:05:30Z, faucet on, sealed-notes key still `ae74cf06…`. Gotchas: (1) **the shade CLI keyring on WSL is the kernel keyring, wiped on every WSL restart**; re-set the Phala key with `shade auth` and the testnet account (`paid-outside.testnet` = `.env` sponsor) via the CLI's `setNearCredentials`. (2) `tee-agent.ts upgrade` needs the CVM **running** (it reads live tcb_info); `start` it first. (3) `env` right after `upgrade` gets "Another operation is already in progress" until the reboot ends; retry. Its new hash must be approved at once (`approve`).
- 2026-11-05 — [VERIFIED] **Hosted demo live:** web at `https://inheirit.vercel.app` (Vercel, Root Directory `web`, branch `main`) against `inheirit.testnet` + the TEE agent. The human ran guardian vote → Challenge → cancel, and Scenario B stage 1 (NEAR + Sepolia released, owner's return halted the rest). BTC showed "nothing to send": the demo faucet's BTC send failed silently and the will was marked funded. Fixed (`063dae3`): faucet errors are logged, each chain is funded once per will and a failed chain can be retried (3 tries/day per owner). [VERIFIED] cause from the TEE logs: `BTC broadcast 400: bad-txns-inputs-missingorspent`. mempool.space keeps listing a UTXO for a while after it is spent, so a faucet send soon after an earlier one reused it. Fixed in the next image: the faucet remembers the outpoints it spent and retries once on that error. The human's retry with the button funded 20,000 sats.
- 2026-11-05 — [VERIFIED] **FastNEAR 429s in the TEE** with one user (Phala's egress IP is shared). Fix: a FastNEAR API key (dashboard.fastnear.com) in `NEAR_RPC_URL=https://test.rpc.fastnear.com?apiKey=…`. The agent moves `apiKey` into an `Authorization: Bearer` header (`rpcEndpoints`, `a221147`) because near-js puts RPC URLs in error messages and the TEE logs are public.
- 2026-11-05 — [VERIFIED] **near-js `FailoverRpcProvider` crashes a fresh agent.** It fails over on *any* error, so "account doesn't exist" (every new implicit agent account at boot) became "Exceeded 2 providers", which ShadeClient doesn't recognise: the day5 agent crash-looped with a 2-URL list. Mitigated by a single URL in the TEE env; fixed in code by `src/near-rpc.ts` (fail over only on HTTP-status/network errors), which ships with the next image. Until then keep `NEAR_RPC_URL` to one URL.
- 2026-11-05 — [VERIFIED] **Scenario B on the hosted app, all three chains, to Completed.** Owner `alice.inheirit-kjgw3v.testnet`, heir `bola.inheirit-kjgw3v.testnet`, TEE agent on day5 image. Vaults: 1 NEAR, 0.002 Sepolia ETH + 20,000 sats from the demo faucet (BTC needed one press of "Fund empty vaults" after the `missingorspent` failure). Released 10% / 30% / 60%, one stage a minute (10:17–10:20Z): NEAR 0.1 / 0.3 / 0.6 by contract transfer; ETH 0.0002 / 0.0006 / 0.0011999 (`0x7b3e9c6f…374e`, `0xbfd8c044…faa3`, `0xba164d1f…e2f9`); BTC 2,000 / 6,000 / 11,608 sats (`11ebedc2…bb55`, `790c2d40…ef9`, `6b2bc7de…dda`); the last stage pays what's left after fees. ETH and BTC went to the faucet pool addresses (= the demo heir's receive addresses), so the coins recycle. Each BTC stage needed one MPC signature and landed ~12 s after the ETH one. Not tested in this run: the heir never registered a key, so 0 notes were re-sealed (heir claim on the hosted app is still to do).
- 2026-11-05 — The human's earlier hosted run (owner `alice.inheirit-6d9m66.testnet`): guardian vote, owner cancel on attest, and Scenario B stage 1 on NEAR + ETH with the owner's return halting the rest (`owner_alive`). It also showed the repeated **vote-expired cycle**: with no guardian action the 300 s vote fails, the will returns to Active (old `last_alive_at`, by design §5.3 / Decision 2026-10-27 (8)) and the ladder restarts about every 7 min, re-sending the same notifications. The event log now labels it (`063dae3`); the repeated notifications are still noisy (improvement list).
- 2026-11-05 — **v2 spec merged** from the human's `CLAUDE-update-v2.md` after a plan-mode reconciliation against the code. The human approved the reconciliation, including the resolutions below. §2.1, §2.3, §2.4, §5.5, §7.1, §7.3, §7.5, §7.6, §7.7, §7.8, §8, §9, §10, §12, §13 and §14 were rewritten or extended. v1 history (§5.1–§5.4, earlier log entries) is kept.
- 2026-11-05 — Pitch fixed: "A will that doesn't make you prove you're alive."
- 2026-11-05 — Signals and checks are separate layers. Replies to checks are weighted signals: DM weak, Telegram medium, heartbeat strong.
- 2026-11-05 — Telegram is the real check channel for the hackathon (bot, long polling, timestamps only).
- 2026-11-05 — Last-known-workplace outreach and employee directories are removed permanently. They are intrusive and risk harm to living owners.
- 2026-11-05 — The standard schedule is 10/20/30/40 with the longest wait after the first slice. The accelerated schedule is 10/30/60, and only a lawyer attestation or a guardian quorum with evidence can trigger it. Acceleration never skips the challenge period or a stage. The 40/60 option is dropped.
- 2026-11-05 — Final secrets are a separate, last stage after distribution plus a buffer, released per heir.
- 2026-11-05 — Guardians must accept their invites, and only accepted guardians count. A will must be "armed" to escalate.
- 2026-11-05 — Heirs are hidden by default until execution.
- 2026-11-05 — Sign-up is minimised to a display name (+ optional jurisdiction). No date of birth, nationality or photo.
- 2026-11-05 — Progressive onboarding: a 3-step minimum will plus a will-strength checklist.
- 2026-11-05 — Build runs Nov 5–7. Nov 8–14 is reserved for break/audit/polish/demo. Aim to submit Nov 13.
- 2026-11-05 — **Reconciliation resolutions** (where v2 conflicted with itself or with the code; the human approved these recommendations):
  - (1) **Medium = trustWeight 0.7, which counts alone**, the same threshold as strong. The scorer stays two-tier at 0.7. Gmail and Calendar (SIMULATED, 0.7) already count alone today.
  - (3) **`wait_after` of the last stage** is the gap between the last slice and the start of SecretsBuffer. It also lets the foreign chains finish, so SecretsBuffer needs every (stage, chain) done.
  - (4) **Accelerating:** before Executing, the will switches to the full 10/30/60 schedule. During Executing, it keeps the remaining percentages and takes only the accelerated waits, so totals stay at 100 and no stage is skipped.
  - (5) **The contract's "armed" check** is accepted guardians ≥ threshold plus ≥ 1 heir. The contract can't see the signal configuration, so "≥ 1 strong signal source" is checked by the agent and UI; the owner's own NEAR account always counts.
  - (6) **Heirs hidden at the UI, API and notification level only** (cut line 1 taken up front). NEAR payouts and `register_heir_key` need heir accounts on-chain, so contract state stays readable. This is documented as a limitation.
  - (7) **A lawyer's death proof during GuardianVote only sets `accelerated`.** The guardian quorum is still needed to reach Challenge, which protects against a lawyer colluding with an heir.
  - (8) **Email has no sender yet** (v1 cut line). Checks are: heartbeat app (UI) and Telegram, which are real; email, which goes to the UI log only (Resend is optional and needs a key); DMs, which are SIMULATED log entries.
  - (9) **The baseline is display-only** ("usually active every N days", from the NEAR tx history). The contract's `quiet_after` stays a fixed owner setting.
  - (10) **The pending day6 image** (`66758d5` faucet, `3f3433b` RPC failover) ships inside the v2 Day A image, which means one human docker build instead of two. The README `<WEB_URL>` pass moves to Nov 11. The hosted heir-claim test moves into Day C.
  - Also decided: `SecretsReleased → Completed` once every sealed note has been released, so a late heir key registration still works. A sign of life in SecretsBuffer or SecretsReleased returns the will to Active and halts the notes not yet released. Accepted guardians and the lawyer may also `contact_confirm_alive` during Quiet/WelfareCheck, which can only delay. The display name and jurisdiction live in the off-chain policy, not on-chain.
- 2026-11-05 — **Gaps found while reconciling:**
  - (a) §12 Day 3 planned a NEAR AI attestation check **at startup**, but only the lazy `AttestationGate.require()` before each AI call exists (`src/ai/attestation.ts`). The boot check moves to Day B.
  - (b) No email sender was ever built. Every notification record is `channel: "ui"`.
  - (c) The duplicate notification cards come from `notificationsFor` in `src/escalation/driver.ts`, which writes one record per owner recipient ("(wallet)", the email address, "(heartbeat app)").
  - (d) Code that depends on `stages_pct` / `stage_interval` and must change with §5.5:
    - agent: `src/near/will-contract.ts`, `src/escalation/driver.ts`, `src/executor/amounts.ts`, `src/executor/executor.ts`, `src/policy/policy.ts`;
    - web: `web/src/lib/will.ts` (`nextStepIn`, `LADDER`), `web/src/lib/config.ts` (`DEMO_TIMINGS` / `REAL_TIMINGS`), `web/src/lib/demo.ts`, `web/src/components/WillParts.tsx`;
    - scripts: `scripts/demo-cancel.ts`, `scripts/demo-execute.ts`, `scripts/demo-sealed-note.ts`, `scripts/day1-walkthrough.mjs`.
- 2026-11-05 — [VERIFIED] **Contract v2 is on `inheirit.testnet`** (commit `6dd38ac`).
  - Built with the pinned `sourcescan/cargo-near@sha256:772638e3…` image (1 min 20 s warm). The wasm is 933 KB, so `funding_amount` is now 11. The on-chain code hash `AiH4dQPEnqPn6fTF65rP3PzBA7e9t7DpQC1ndvZJ4nCn` matches the build.
  - `shade deploy` (TEE mode) wiped the state in place (the account was not deleted, so vault addresses are unchanged) and re-initialised it: `requires_tee: true`, owner `paid-outside.testnet`.
  - `tee-agent.ts approve` re-approved the live compose hash `bd3a0e88…` and 23 of 26 PPIDs.
  - Tests: 148 unit, 8 sandbox.
  - The wipe dropped every v1 will and the agent registration. 0.9 testnet NEAR that was in v1 demo vaults now sits in the contract balance, unassigned.
  - The running v1 agent (day5 image) is **not registered** on the new contract and can't read v2 wills. It sends no failing transactions, so no NEAR burns. `get_agent_pubkey` is null until the v2 agent registers and re-publishes the same key (same app_id).
  - The hosted web app (`stages_pct` / `stage_interval`) can't create wills until the web app is updated.
  - Still to redeploy: `inheirit-dev.testnet` (local mode).
- 2026-11-05 — [VERIFIED] **Day A on `inheirit-dev2.testnet`** (a new local-mode v2 dev contract, created via the faucet helper, 9.96 NEAR; local agent `2e14c536…0e25` whitelisted). `scripts/demo-telegram.ts` (owner `tgalice2.inheirit-fund-sp6ecr.testnet`) checked:
  - the unarmed will stayed Active through 150 s of silence (quiet_after 120);
  - the guardians accepted → armed → Quiet → checks sent (heartbeat app, email shown in-app, Telegram, SIMULATED DM);
  - the human replied in Telegram at 12:03:38Z → `record_liveness` → Active in about 15 s, vault untouched.
- 2026-11-05 — **Telegram implementation** (§7.7), as built:
  - Bot `@inheirit_liveness_bot`, with long polling in `src/telegram/bot.ts`.
  - `POST /api/telegram/link` must be NEP-413 signed (action `telegram_link`, full-access key) and returns a one-time 15-minute `t.me` link. `GET /api/telegram/:account` returns the link status.
  - The bot stores only the receive time of each reply (`telegramReplies`), never the text, and never logs chat IDs or tokens. The bot token is scrubbed from errors.
  - [VERIFIED] **Telegram Desktop, with an existing chat, may not send the deep link's hidden token**: the first link never arrived. The UI and scripts therefore also show `/start <token>` to paste, which works.
  - [VERIFIED] A `/start` sent before the agent was polling sits in the update queue and is answered "link not valid" when polling starts. This is harmless.
  - **Only one poller per bot token**, so the local agent and the TEE agent must not both run with the token.
- 2026-11-05 — **Notifications are grouped** (§7.3): one record per event, `{event, to[], channels[], subject, body}`. Quiet sends no state notice; it runs the four spaced checks instead. Telegram is added to any event with a linked recipient.
- 2026-11-05 — **Schedules as code:** `src/policy/schedule.ts` turns the policy's `stages_pct` into the contract's `stages`:
  - the first wait is longest (demo 180 s, then 60 s; real 90 d, then 30 d);
  - `accelerated_stages` are 10/30/60 (demo 60 s, real 14 d);
  - `summarize()` produces the setup summary (demo: earliest move 6 min, full distribution 11 min, secrets 13 min; real: about 74 d, 224 d, 284 d).

  The policy keeps percentages only. Its default is now 10/20/30/40, plus optional `lawyer`, `display_name` and `jurisdiction`. The web app and scripts use the same module.
- 2026-11-05 — [VERIFIED] **Secrets last, end to end on `inheirit-dev2.testnet`** (`scripts/demo-sealed-note.ts`, owner `secretsv2.inheirit-fund-sp6ecr.testnet`).
  - The English will went through NEAR AI (attested, signed response) and became 50/50 stages with waits of 180 s, then 60 s.
  - The ladder: Quiet 127 s → WelfareCheck 200 s → GuardianVote 273 s → 2 guardians → Challenge 289 s → Executing 404 s → SecretsBuffer 691 s → SecretsReleased 765 s.
  - The note was released only after that. The heir decrypted it, and another key could not.
  - Cosmetic: the driver's "advanced to X" log sometimes prints the previous state, because the re-read right after `advance` can lag the RPC. State handling is unaffected, since the next tick reads the new state.
- 2026-11-05 — **Day B, first part** (commit `1ad60ca`):
  - The deterministic verdict (`src/liveness/verdict.ts`) is in `GET /api/signals/:owner`.
  - The agent checks the NEAR AI model's attestation at startup.
  - The web app has the `SignsOfLife` hero panel on `/owner` and `/demo`, and the demo timeline uses plain words.
  - Verified by screenshot against the local agent (no console errors), **except the snap-back animation, which has not been seen running yet**.
  - **Not built:** the baseline ("usually active every N days"). The adapters keep only the latest time per source, so there is no history to compute it from. Roadmap.
- 2026-11-05 — [VERIFIED] **Repeat Telegram checks from abandoned test wills.** After the Telegram test, the silent owner `tgalice2` re-escalated, and each new Quiet sent the human another Telegram check. This is the vote-expired cycle (§7.3, known noise), now reaching a real phone.
  - Mitigated: the test wills were removed from the local agent's watch list and the test chat was unlinked (`data-v2`).
  - In demo mode, the 3 h `DEMO_WATCH_HOURS` limit bounds it.
  - Improvement to consider: after a failed vote, wait a full `quiet_after` before the next check round, or cap Telegram checks per day.
- 2026-11-05 — [VERIFIED] **v2a agent live in the TEE** (in-place upgrade, same CVM and app_id).
  - The image `…@sha256:d963ec85…` was approved as `f7e8c235…` before the reboot. The agent registered on the v2 `inheirit.testnet` at 12:42:57Z and **re-published the same sealed-notes key `ae74cf06…`**. The NEAR AI startup check passed.
  - As expected from 2026-10-29, the compose update kept the old `allowed_envs`, so the agent logged "TELEGRAM… not set". `tee-agent.ts env` (`allowed_envs_changed: true`) restarted it at 12:44:27. `approve` for `f8ddfdc4…` landed about 30 s later.
  - The agent had 2 failed register attempts (about 0.04 NEAR) and registered at 12:45:15. The Telegram bot is on.
  - `retire` takes **one hash per call**. Both `bd3a0e88…` and `f7e8c235…` are retired.
- 2026-11-05 — [VERIFIED] **Scenario A on the hosted stack** (`inheirit.testnet` and the v2a TEE agent, owner `hosteda.inheirit-fund-sp6ecr.testnet`, `scripts/demo-cancel.ts`).
  - The ladder: Quiet 125 s → WelfareCheck 189 s → GuardianVote 254 s → Challenge 259 s.
  - The lone SIMULATED X post was ignored: still Challenge 40 s later.
  - The signed heartbeat brought the will back to Active, with the vault untouched.
  - Screenshots came from the same web code run locally against the hosted backend: the verdict explaining the ignored X post, and **the snap-back flash, seen running**.
  - Fixed: at the snap-back, the verdict box lagged a poll behind ("Challenge period…" next to All good). The panel now refetches on every state change and shows "Sign of life recorded…" while the flash is up.
- 2026-11-05 — [VERIFIED] **`inheirit.vercel.app` is behind Vercel's Security Checkpoint.** curl gets a 403 challenge page, and headless Chromium gets "Failed to verify your browser (Code 21)". Normal browsers pass. Risk: AI judges fetching the site with tools would be blocked. Asked the human to check Vercel → Firewall (Attack Challenge Mode / bot protection). Until then, test the hosted backend by running `web/` locally with `NEXT_PUBLIC_AGENT_URL` set to the TEE URL and `NEXT_PUBLIC_CONTRACT_ID=inheirit.testnet`.
- 2026-11-05 — [VERIFIED] **Day C on the hosted stack** (web run locally against `inheirit.testnet` + the v2a TEE agent; commit `0fcbda5`).
  - 3-step onboarding: a browser demo cast → Quick setup → the will was created "not armed" → two guardians accepted on `/guardian` → the owner's checklist said "armed".
  - `scripts/demo-accelerate.ts` (owner `accela`): the lawyer's death proof in GuardianVote set `accelerated` and the will stayed in GuardianVote; the quorum moved it to Challenge; the challenge period was kept (~128 s of 120); it ran the 10/30/60 accelerated stages, then SecretsBuffer, SecretsReleased and Completed, leaving the vault empty.
  - Heir claim through the UI (owner `alice.inheirit-xskia2.testnet`): the heir registered a key on `/heir`; the guardians confirmed in `/demo`; the note was released at about 770 s and decrypted in the browser. The heir page suggested no heirs from the will (heirs hidden).
  - **Not verified:** the AI guide answer. It was still "Working…" after 60 s, versus about 31 s on 2026-10-29.
- 2026-11-05 — **Vercel challenged the human's IP** (automatic DDoS mitigation, ~90-request spikes).
  - The app itself does not poll Vercel: it polls the TEE agent and FastNEAR. Vercel only sees page loads and `<Link>` prefetches.
  - The likely cause was **Claude's own shell loops from this machine** during the deploy check (12:48–12:58Z): about 40 fetches of `/owner`, plus two commands that each fetched `/owner` and up to 30 JS chunks.
  - **Rule:** never script requests at the deployed site. Test with the local dev server pointed at the hosted backend, and let the human open the hosted URL.
- 2026-11-05 — [VERIFIED] **Polling reduced** (commit `c0413ea`). Measured on an owner dashboard over 60 s: **103 req/min before → 52 now → about 24** once the agent image has `/api/overview` (the web app falls back to the old routes until then).
  - The tab is paused while hidden, with exponential backoff to 60 s.
  - `useWill` polls every 8 s, or every 3 s near a countdown.
  - A "boost" to 2 s for 20 s follows any transaction or agent write, which keeps the snap-back fast.
  - Reads within 1.5 s are shared.
  - **Needs an agent image rebuild** (`/api/overview`).
- 2026-11-05 — [VERIFIED] **v2b live in the TEE** (in-place upgrade, approved before the reboot, no env change). Registered at 14:07:17Z on the first try. The sealed-notes key was unchanged, `/api/overview` answers, and the old hash `f8ddfdc4…` is retired. The human authorised pushes and further work while away (2026-11-05). The hard rules (testnet only, no public repo, no posts, no submission) are unchanged.
- 2026-11-05 — [VERIFIED] **Independent audit of the v2 work**, by a fresh subagent given only the spec and the diff, with findings verified before fixing.
  - **Fixed, contract** (`2885f1d`):
    - (1) **High:** a sign of life seen during Challenge but recorded after someone else called `advance` (execution already started) only moved `last_alive_at`, and the release went on. Now, in any state but Active or Completed, `record_liveness` with a time newer than `last_alive_at` returns the will to Active. This supersedes the Day 1 rule 2026-10-27 (6): the comparison is no longer against the current state's start.
    - (2) `vote_failed` now clears `accelerated` and `death_proofs`.
    - (3) Added `remove_guardian`.
    - The storage layout is unchanged, so `scripts/upgrade-contract-code.ts` (new) deployed the code over the existing state on `inheirit.testnet` and `inheirit-dev2.testnet`. The code hash is `H7GzqqfhWLdMZTLns5sCmeoyeVQCfsj8p1PuCVAAiw2E`; wills were intact afterwards.
    - [VERIFIED] The `.env` sponsor key (`paid-outside.testnet`) is also the full-access key on `inheirit.testnet`.
  - **Fixed, agent and web** (`d637bd5`, image v2c):
    - Telegram links only private chats; in a group, any member's message would have counted.
    - `/api/status` and `/api/overview` return `watching` as flags, never the owner's email, address or handle.
    - The verdict no longer says "Alive." for an overdue Active will.
    - The snap-back fires only on a new sign of life, with honest wording when stages had already moved.
    - A write clears the shared read cache.
  - **Not fixed (documented):**
    - A will can stay in SecretsReleased forever if a note can't be opened (sealed to an old key) or an heir never registers a key. The money has all gone out by then; an escape (e.g. Completed after a long timeout) is roadmap.
    - `/api/telegram/:account` reveals whether an account linked Telegram (low).
- 2026-11-05 — [VERIFIED] **v2c built and pushed by Claude** (Docker Desktop works from this WSL shell; the push used the human's stored Docker Hub login, under the human's blanket permission for this session) and shipped in place. Registered at 14:25:41Z on the first try, same sealed-notes key, and `f8dd…`/`68ab…` retired. Live: `88deb635…`.
- 2026-11-05 — [VERIFIED] The heir AI guide answered in 32 s with `ok:true` (a signed answer, verified). The earlier "Working…" was a test that didn't wait long enough.
- 2026-11-05 — [VERIFIED] **Regression after the audit fixes and v2c** (hosted `inheirit.testnet` + TEE).
  - **Scenario A** (`demo-cancel.ts`, owner `regressa.inheirit-fund-0am6d3.testnet`) passed.
  - **Scenario B on three chains, entirely through the UI** (owner `alice.inheirit-gzdcfh.testnet`, vaults from the demo faucet; BTC funded on the first try):
    - | Stage | NEAR | ETH (wei) | BTC (sats) |
      |---|---|---|---|
      | 1 (10%) | 0.1 | 2e14 | 2,000 |
      | 2 (20%) | 0.2 | 4e14 | 4,000 |
      | 3 (30%) | 0.3 | 6e14 | 6,000 |
      | 4 (40%) | 0.4 | 7.99999998e14 (rest after fees) | 7,467 (rest after fees) |
    - Then the secrets buffer, the note re-sealed to Bola and opened in the browser, and Completed with the NEAR vault at 0. No page errors.
    - Explorer: Sepolia `0x0df064…76ff`, `0xefac35…e144`, `0x571488…cac9`, `0x319d42…4a9f`; testnet4 `508761…4dae`, `0d2352…2281`, `b51059…aa38`, `0f3696…1695`.
  - The demo funder `inheirit-fund-sp6ecr.testnet` ran dry (0.02 NEAR). The new funder is `inheirit-fund-0am6d3.testnet` (`DEMO_FUNDER_ACCOUNT`).
- 2026-11-05 — **Repeat Telegram messages after an expired vote capped** (agent only, not yet in the TEE image). An expired vote returns the will to Active with the same `last_alive_at`, so each lap re-sent the Telegram check (and guardian welfare/vote messages) to real phones. Now Telegram sends each of those once per silence; repeats are recorded in the app as "not resent". The challenge alarm and heir notices always go out. Tests: 159 vitest.
- 2026-11-06 — [VERIFIED] **v2d live in the TEE** (built and pushed by Claude, in-place upgrade approved before the reboot, no env change). Agent `11a43bc4…` registered on the first try; same sealed-notes key `ae74cf06…`, enabled; `88deb635…` retired, so `b075a4d2…` is the only approved hash. The `-8090` log endpoint returned nothing for a few minutes after the reboot, so check registration with `tee-agent.ts status` instead.
- 2026-11-06 — **NEAR Intents (v3) merged and built** from the human's `CLAUDE-update-v3-intents.md`. The human gave full permission to proceed without the plan-mode wait. The v3 rule that every mainnet transaction needs an explicit "yes" each time was kept: no mainnet transaction was sent. New §9A, a scoped exception under hard rule 1, plus updates to §3, §10, §12 (Nov 8 Intents day), §13 and the README.
  - **Reconciliation:**
    - (a) The vaults still pay testnet slices on schedule. The Intents layer pays each released slice onward to the heir's choice, on a SIMULATED 1Click client in the agent (live prices). Holding a slice *in the vault* until the heir chooses would need contract changes (NEAR slices are paid in `advance()`), so the onward payout waits instead. Documented; roadmap.
    - (b) The agent gets no 1Click key or new TEE env key and never moves mainnet value. Real legs run only via `scripts/mainnet-payout.ts`.
    - (c) `payout_value_mode` is optional in the policy, so existing policy hashes are unchanged.
    - (d) Owner presets of an heir's payout are not built.
    - (e) Confidential Intents stays gated, because its gate needs the mainnet checks first.
  - [VERIFIED] **Live 1Click findings (dry quotes, read-only):**
    - The OpenAPI spec matches the v3 field names.
    - Status also has `KNOWN_DEPOSIT_TX`.
    - Auth: `X-API-Key` (recommended) or a legacy bearer JWT.
    - Placeholder addresses like `0x…dEaD` are rejected ("recipient is not valid").
    - A NEAR recipient must be an existing account (a nonexistent one gives "Internal server error").
    - The same-chain EVM pair Base USDC → Base USDC quotes (v3's "same-chain doesn't quote" was NEAR→NEAR).
    - $0.50 quotes fine.
    - `confidentiality: basic` and `advanced` both quote at the public price.
    - Quotes are in `docs/DEMO.md`.
  - [VERIFIED] **Mainnet Chain Signatures derivation works read-only:** with a placeholder account, `v1.signer` derived a Base address. `v1.signer` has no `experimental_signature_deposit` view, so the sign deposit stays [VERIFY]; the script attaches 1 yocto, as on testnet.
  - **Code:**
    - `src/intents/{oneclick,payout}.ts`;
    - API routes `/api/intents/tokens`, `/api/heir/payout` (signed `payout_pref`, with a route probe), `/api/payouts/:owner` (empty until a slice is released), `/api/intents/fund-quote|fund-sent|status`;
    - web `Payouts.tsx` (heir step, panels, fund from anywhere, mainnet records) and a stable-value checkbox in setup and in the demo;
    - `scripts/mainnet-payout.ts` and `scripts/demo-payout.ts`.
  - Tests: 179 vitest (22 new). Fixed while testing: batch ids collided when two batches were made in the same millisecond, so a retry overwrote the refunded batch.
- 2026-11-06 — [VERIFIED] **v2e live in the TEE** (in-place, no env change). Agent `9c364c97…` registered with the same sealed-notes key. `/api/intents/tokens` serves live 1Click prices from inside the TEE. `b075a4d2…` is retired; `fb1bd5d1…` is the only approved hash.
- 2026-11-06 — [VERIFIED] **Payout scenario on the hosted stack** (`scripts/demo-payout.ts`, owner `payo1.inheirit-fund-0am6d3.testnet`, v2e TEE agent, SIMULATED 1Click).
  - Setup: two heirs at 50/50, 1 NEAR, stable value.
  - `/api/payouts` revealed no heirs before the release.
  - Ada chose ETH on Base before the release. Tobi chose SOL on Solana only after stage 2.
  - The slices worth $0.19 and $0.37 accumulated below the $1 minimum.
  - Result:

    | Heir | Batch | Value | Paid as | Status |
    |---|---|---|---|---|
    | Ada | stages 1+2+3 | $1.12 | USDC on Base (stable mode overrode ETH) | SUCCESS |
    | Ada | stage 4 | $0.75 | USDC on Base, sent when the release ended | SUCCESS |
    | Tobi | stages 1+2+3 | $1.12 | USDC on Solana | SUCCESS |
    | Tobi | stage 4 | $0.75 | USDC on Solana | SUCCESS |

  - Heir page checked in a browser against the hosted agent: the payout choice was saved through the UI; no page errors; no horizontal scroll at 390 px.
- 2026-11-06 — **Break-it session, first pass.** Contract tests already covered the §12 list:
  - signing outside Executing, double attestation, early `store_released_note`;
  - acceleration abuse, the restart snapshot rebuild, empty vaults;
  - attestations and death proofs cleared between rounds.

  One independent reviewer (fresh context, the new Intents and API code only) also ran. Every finding was verified, then fixed with a test.
  - **Fixed, agent:**
    - (1) **`/demo/signal` was unsigned.** On the hosted demo-mode agent anyone could post a SIMULATED Gmail or Calendar signal (0.7, counts alone) for any owner and keep the will from ever executing. It is now signed by the owner (NEP-413 `demo_signal`); the web demo and `demo-cancel.ts` sign it.
    - (2) **Bitcoin dust stalled a will forever.** A stage paying an heir fewer than 546 sats threw on every tick, so the will never reached the secrets buffer and the notes were never released. Now:
      - a slice below dust is deferred to the final sweep;
      - the sweep pays the heirs whose share clears dust (dust-sized shares go to them, not to miners);
      - a vault holding only dust completes the stage.
      ETH gets the same treatment for a last-stage leftover under 0.0001 ETH that can't pay its gas; a larger balance keeps retrying.
    - (3) **Policy:** two heirs sharing a receive address are now rejected. Foreign execution records name only the address, so the second heir looked already paid.
    - (4) **NEP-413:** the nonce is claimed before the key lookup, so two concurrent replays can't both pass.
  - **Fixed, Intents (reviewer):**
    - (5) direct mode is used only when the slice already went to the address the heir chose; it used to mark another address as paid;
    - (6) transient 1Click errors back off without counting toward giving up (an outage of ~9 min used to strand the slices for good);
    - (7) a `SENDING` marker before each deposit: after a crash a real sender checks 1Click's status and never resends blindly;
    - (8) a SIMULATED deposit forgotten in a restart is quoted again, not counted as a failure;
    - (9) a duplicated execution record (after a retried `record_execution`) is one slice;
    - (10) `/api/payouts` is hidden again after a halt, and payout addresses are masked;
    - (11) unsigned fund quotes use a separate client and a rate limit (30/h per owner, 600/h in total); zero amounts and missing vaults are refused.
  - **Fixed, `mainnet-payout.ts`:**
    - (12) `amountIn` must equal the capped amount;
    - (13) the ledger reserves the spend before signing;
    - (14) a non-numeric cap is refused (NaN had turned the caps off).
  - Tests: 192 vitest. Shipped as v2f.
- 2026-11-06 — [VERIFIED] **Hosted backend down for ~40 min (10:12–10:53Z): sponsor drained.**
  - Cause: every TEE reboot creates a new implicit agent account, which the sponsor funds with 0.5 NEAR. Today's upgrades (v2d, v2e, v2f) left `paid-outside.testnet` at 0.43 NEAR, so funding failed, the agent exited with code 1, and `restart: always` crash-looped it. The CVM showed `running`, the container `Restarting (1)`, load 30–70, and both gateway ports returned an empty reply (the `-8090` log endpoint too, so there were no logs to read).
  - Diagnosis: v2f ran fine locally against `inheirit-dev2.testnet`, and a rollback to the previously working v2e crash-looped the same way, so the code was ruled out. The sponsor balance was the answer.
  - Fix: 3 NEAR from the demo funder `inheirit-fund-0am6d3.testnet` to the sponsor (tx `E5dncSfT92549y1RKBXp7zBwtNrECV93iB32tHjB8kXJ`), then v2f redeployed. The agent `ff3dff59…` registered with the same sealed-notes key, and an unsigned `/demo/signal` now returns 401. `bc3becbf…` is the only approved hash.
  - Prevention: `tee-agent.ts upgrade|env|start` check that the sponsor has ≥ 1 NEAR first.
  - Diagnostic helper (no route in the tool yet): `GET cloud-api.phala.network/api/v1/cvms/<uuid>/composition` shows the container state. It said `Restarting (1)`.
- 2026-11-06 — [VERIFIED] **Regression on v2f** (hosted). `demo-cancel.ts`, owner `regressb.inheirit-fund-0am6d3.testnet`, passed: the owner-signed SIMULATED X post was ignored on its own, and the signed heartbeat cancelled Challenge → Active with the vault untouched. `next build` passes for the web app.
- 2026-11-06 — [VERIFIED] **Nov 10 audit, done early.** A fresh subagent with no prior context reviewed the contract and agent against the threat model and this spec, and reported findings only. Every finding was checked in the code before fixing; each fix has a test (agent 206 vitest, contract 157 unit + sandbox).
  - (1) **High: the contract's only full-access key was inside the TEE.** `SPONSOR_PRIVATE_KEY` (`paid-outside.testnet`) is the sole key on `inheirit.testnet` and the contract owner, and it was pushed to the CVM as the agent's sponsor. Code in the TEE could have redeployed the contract and drained every vault, bypassing all gating. Fixed: a separate TEE sponsor `tee-sponsor.inheirit-fund-0am6d3.testnet` (2.5 NEAR from the demo funder) with no key on the contract. `tee-agent.ts` sends `TEE_SPONSOR_*` as `SPONSOR_*` and refuses a sponsor key that is an access key on the contract. The operator key itself is now a documented THREAT_MODEL row; a timelocked multisig owner is the production fix. Optional follow-up: rotate the `paid-outside.testnet` key, since earlier images held it (in attested code only).
  - Found while shipping: **`tee-agent.ts` never loaded `.env` into `process.env`**, so the sponsor-balance guard added after the outage silently skipped itself. It now loads dotenv, and a missing sponsor is an error.
  - (2) **High: the BTC 16-signature cap could block the last stage forever.** A stranger could send 17 tiny UTXOs to the public vault, and timeouts also consumed signatures. Fixed: at most 8 inputs per tx (the largest, skipping UTXOs worth less than their spend fee or already spent), and each MPC signature saved as it arrives (`btcSigning` in the store).
  - (3) **High (hosted): `/api/owners` was unsigned in demo mode,** so anyone could point a will at a busy EVM address and keep it alive forever. Fixed: every agent write route is NEP-413 signed in every mode, including `/api/policy/draft`. `demo-execute.ts` and `demo-sealed-note.ts` now sign (`signedRequest` in `scripts/lib/near.ts`).
  - (4) The will's own ETH vault or an heir's receive address is refused as the owner's watched EVM address, so the release can't halt itself.
  - (5) **Contract: the 200-record cap could freeze a will in Executing.** Fixed: heirs × stages ≤ 40 (also checked in the policy); a full list drops earlier rounds' records; the agent's foreign records are capped at 80 per round; only the last 20 halts are kept (9). Code-only upgrade (`upgrade-contract-code.ts`, layout unchanged) on `inheirit.testnet` and `inheirit-dev2.testnet`: code hash `B93TMxEhMXZJsdHAREnDYTHncHnE1Het2hXVLEX8XdKB`, existing wills readable.
  - (6) **Stale pending txs retried forever.** BTC: a tx whose input another tx spent is dropped and re-planned. ETH: a stage's heirs get consecutive nonces, and a tx whose nonce another tx used is dropped after looking dead on two checks 2 min apart (a lagging node must not cause a double payment).
  - (7) **Spec gap: owner withdrawals from the ETH/BTC vaults were queued but never sent.** The agent now sends them while Active (`sendWithdrawal`, Withdrawal signing purpose, idempotent via `pendingTxs`), and `/owner` has a form.
  - (8) Notification recipients are masked in public routes (emails shortened, heirs hidden unless in a revealed state); `/api/notifications` needs `owner`.
  - (11) An expired 1Click quote is re-quoted instead of counting as a failed attempt.
  - **Not fixed, documented:** (10) a will created by hand with a foreign vault but no allocation for its asset leaves those coins in the vault (the web app derives `foreign_chains` from the allocations, so only a hand-made contract call does this); the NEP-413 nonce cache is in memory, so an agent restart reopens the 5-minute replay window for already-signed requests.
  - [VERIFIED] The NEAR AI TDX check still passes from inside the TEE: gateway and model TDX quotes `UpToDate`, report_data binds signer and nonce, NVIDIA GPU attestation passes.
  - **v2g shipped** in place (approved before the reboot). The agent `4808c109…` registered with the same sealed-notes key `ae74cf06…` and was funded by the new TEE sponsor; `paid-outside.testnet` was untouched. An unsigned `/api/owners` now gets 401. `bc3becbf…` is retired, so `02cc55b9…` is the only approved hash.

