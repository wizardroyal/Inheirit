//! Heirloom will: the state machine from CLAUDE.md §5 (v2: §5.5). One contract holds many wills,
//! keyed by owner.
//!
//! All times are UNIX seconds; all durations are seconds. Amounts on foreign chains are decimal
//! strings in the chain's smallest unit (wei, sats); NEAR amounts are yoctoNEAR.

use crate::*;
use near_sdk::json_types::{Base64VecU8, U128};

pub mod agent;
pub mod events;
pub mod owner;
pub mod parties;
#[cfg(test)]
mod tests;
pub mod views;

pub use agent::SignPurpose;
use events::emit;

// Size caps keep each will's storage (and the gas to load it) bounded.
pub const MAX_HEIRS: usize = 10;
pub const MAX_GUARDIANS: usize = 10;
pub const MAX_CONTACTS: usize = 10;
pub const MAX_STAGES: usize = 10;
pub const MAX_NOTES: usize = 10;
/// Shortest allowed timing or stage wait. The demo uses 60 s and up (accelerated tests 20 s); shorter only lets a will
/// cycle the ladder fast enough to burn the agent's gas (audit round 3).
pub const MIN_TIMING_S: u64 = 20;
pub const MAX_NOTE_CIPHERTEXT_BYTES: usize = 2048;
/// A note re-sealed to the heir's key: crypto_box_seal adds 48 bytes.
pub const MAX_RELEASED_NOTE_BYTES: usize = MAX_NOTE_CIPHERTEXT_BYTES + 48;
pub const MAX_LABEL_CHARS: usize = 64;
pub const MAX_NAME_CHARS: usize = 64;
pub const MAX_PENDING_WITHDRAWALS: usize = 5;
/// One MPC signature per EVM tx, one per BTC input. Bounds what the agent can sign per stage.
pub const MAX_SIGNATURES_PER_STAGE_CHAIN: u8 = 16;
pub const MAX_SIGNATURES_PER_WITHDRAWAL: u8 = 16;
pub const MAX_EXECUTION_RECORDS: usize = 200;
/// heirs × stages (of the longer schedule) per will. One round then records at most
/// 40 × 3 chains = 120 transfers, so a round always fits under MAX_EXECUTION_RECORDS.
pub const MAX_HEIR_STAGE_SLICES: usize = 40;
/// Only the most recent halts are kept (each false alarm adds one; the contract pays their storage).
pub const MAX_HALT_RECORDS: usize = 20;
/// The lawyer plus every guardian.
pub const MAX_DEATH_PROOFS: usize = MAX_GUARDIANS + 1;
pub const MAX_REF_CHARS: usize = 128; // addresses and tx hashes
pub const BPS_TOTAL: u16 = 10_000;

const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chain {
    Near,
    Eth,
    Btc,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WillState {
    Active,
    /// Silence passed quiet_after; the owner is nudged.
    Quiet {
        since: u64,
    },
    /// Trusted contacts are asked.
    WelfareCheck {
        since: u64,
    },
    /// Guardians are asked to attest.
    GuardianVote {
        since: u64,
    },
    /// Quorum reached; the owner can still cancel.
    Challenge {
        since: u64,
    },
    /// `since` is when execution started (stage 0); `stage_started` is when the current stage did.
    Executing {
        stage: u8,
        since: u64,
        stage_started: u64,
    },
    /// Distribution is complete; sealed notes wait out `secrets_buffer` before release.
    SecretsBuffer {
        since: u64,
    },
    /// The agent may now re-seal notes to heirs; Completed once every note is released.
    SecretsReleased {
        since: u64,
    },
    Completed {
        at: u64,
    },
}

impl WillState {
    /// When the current escalation state was entered, or None for Active/Completed.
    pub fn since(&self) -> Option<u64> {
        match self {
            WillState::Quiet { since }
            | WillState::WelfareCheck { since }
            | WillState::GuardianVote { since }
            | WillState::Challenge { since }
            | WillState::Executing { since, .. }
            | WillState::SecretsBuffer { since }
            | WillState::SecretsReleased { since } => Some(*since),
            WillState::Active | WillState::Completed { .. } => None,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            WillState::Active => "Active",
            WillState::Quiet { .. } => "Quiet",
            WillState::WelfareCheck { .. } => "WelfareCheck",
            WillState::GuardianVote { .. } => "GuardianVote",
            WillState::Challenge { .. } => "Challenge",
            WillState::Executing { .. } => "Executing",
            WillState::SecretsBuffer { .. } => "SecretsBuffer",
            WillState::SecretsReleased { .. } => "SecretsReleased",
            WillState::Completed { .. } => "Completed",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Timings {
    pub quiet_after: u64,
    pub nudge_period: u64,
    pub welfare_period: u64,
    pub vote_period: u64,
    pub challenge_period: u64,
    /// Wait between the end of distribution and the release of sealed notes.
    pub secrets_buffer: u64,
}

/// One release slice: `pct` of the vault snapshot, then `wait_after` seconds until the next
/// slice (after the last slice: until SecretsBuffer starts).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stage {
    pub pct: u8,
    pub wait_after: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Guardian {
    pub account_id: AccountId,
    /// Only accepted guardians count toward the quorum and arm the will.
    pub accepted: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeathProof {
    pub by: AccountId,
    pub evidence_hash: String,
    pub at: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct HeirInput {
    pub account_id: AccountId,
    pub name: String,
    /// This heir's share of the NEAR vault in basis points. Foreign-chain shares live in the
    /// off-chain policy (policy_hash) and are applied by the agent.
    pub near_share_bps: u16,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Heir {
    pub account_id: AccountId,
    pub name: String,
    pub near_share_bps: u16,
    /// Hex X25519 public key, registered by the heir for sealed notes.
    pub x25519_pubkey: Option<String>,
}

/// Everything the owner sets in create_will / update_will.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct WillConfig {
    pub heirs: Vec<HeirInput>,
    /// Invited guardians; each must call accept_guardian before it counts.
    pub guardians: Vec<AccountId>,
    pub guardian_threshold: u8,
    pub contacts: Vec<AccountId>,
    /// Standard schedule (CLAUDE.md §5.5: 10/20/30/40, longest wait after the first slice).
    pub stages: Vec<Stage>,
    /// Schedule used after a death proof (e.g. 10/30/60 with short waits).
    pub accelerated_stages: Vec<Stage>,
    pub timings: Timings,
    /// Hex sha256 of the approved policy JSON.
    pub policy_hash: String,
    /// Foreign chains with an MPC-derived vault (Eth, Btc).
    pub foreign_chains: Vec<Chain>,
    /// May attest a death proof and is part of the welfare chain. May also be a guardian.
    pub lawyer: Option<AccountId>,
    /// Hide heir identities in the UI, agent API and notifications until execution. The
    /// contract state itself stays readable (CLAUDE.md §2.4).
    pub heirs_hidden: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttestKind {
    Deceased,
    Alive,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GuardianAttestation {
    pub guardian: AccountId,
    pub kind: AttestKind,
    pub evidence_hash: Option<String>,
    pub at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SealedNote {
    pub id: u32,
    pub heir: AccountId,
    pub label: String,
    /// crypto_box_seal ciphertext to the agent's X25519 key.
    pub ciphertext: Base64VecU8,
    pub created_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReleasedNote {
    pub note_id: u32,
    pub heir: AccountId,
    pub label: String,
    /// The note re-sealed by the agent to the heir's X25519 key.
    pub ciphertext: Base64VecU8,
    pub at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Withdrawal {
    pub id: u32,
    pub chain: Chain,
    pub to: String,
    pub amount: U128,
    pub created_at: u64,
    pub signatures: u8,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionRecord {
    pub round: u32,
    pub stage: u8,
    pub chain: Chain,
    pub to: String,
    pub amount: String,
    /// Foreign tx hash. Empty for NEAR releases, which are receipts of the advance() call.
    pub tx_hash: String,
    pub at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HaltRecord {
    pub round: u32,
    pub stage: u8,
    pub at: u64,
    pub reason: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StageChain {
    pub stage: u8,
    pub chain: Chain,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignCount {
    pub stage: u8,
    pub chain: Chain,
    pub count: u8,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Will {
    pub owner: AccountId,
    pub heirs: Vec<Heir>,
    pub guardians: Vec<Guardian>,
    pub guardian_threshold: u8,
    pub contacts: Vec<AccountId>,
    pub stages: Vec<Stage>,
    pub accelerated_stages: Vec<Stage>,
    pub timings: Timings,
    pub policy_hash: String,
    pub foreign_chains: Vec<Chain>,
    pub lawyer: Option<AccountId>,
    pub heirs_hidden: bool,
    pub state: WillState,
    pub last_alive_at: u64,
    pub created_at: u64,
    /// Attestations of the current vote; cleared whenever the will returns to Active.
    pub attestations: Vec<GuardianAttestation>,
    pub sealed_notes: Vec<SealedNote>,
    pub next_note_id: u32,
    pub released_notes: Vec<ReleasedNote>,
    pub near_balance: U128,
    /// NEAR vault balance when the current execution round started.
    pub near_snapshot: U128,
    pub pending_withdrawals: Vec<Withdrawal>,
    pub next_withdrawal_id: u32,
    /// Incremented each time execution starts; a halted will that escalates again runs a new round.
    pub execution_round: u32,
    pub executions: Vec<ExecutionRecord>,
    /// Foreign (stage, chain) pairs the agent has finished in the current round.
    pub stage_done: Vec<StageChain>,
    /// MPC signatures requested per (stage, chain) in the current round.
    pub sign_counts: Vec<SignCount>,
    pub halted: Vec<HaltRecord>,
    /// Set by a death proof; cleared whenever the will returns to Active.
    pub accelerated: bool,
    /// Death proofs of the current escalation; cleared whenever the will returns to Active.
    pub death_proofs: Vec<DeathProof>,
    /// The schedule of the current (or last) execution round, snapshotted when it started.
    pub round_stages: Vec<Stage>,
    /// When the current (or last) execution round started.
    pub round_started_at: u64,
}

#[near(serializers = [json])]
pub struct ArmedStatus {
    pub armed: bool,
    /// What is still needed, in plain words.
    pub missing: Vec<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentKey {
    pub x25519_pubkey: String,
    /// Phala app_id whose dstack KMS derives this key (CLAUDE.md §7.5).
    pub app_id: String,
    pub set_at: u64,
}

pub fn now_s() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

pub fn vault_path(owner: &AccountId, chain: Chain) -> String {
    let suffix = match chain {
        Chain::Eth => "eth",
        Chain::Btc => "btc",
        Chain::Near => env::panic_str("NEAR vault has no derivation path"),
    };
    format!("heirloom/{}/{}", owner, suffix)
}

pub fn require_hex32(value: &str, field: &str) {
    require!(
        value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()),
        format!("{} must be 32 bytes hex", field)
    );
}

fn require_ref(value: &str, field: &str) {
    require!(
        !value.is_empty() && value.len() <= MAX_REF_CHARS,
        format!("{} must be 1-{} chars", field, MAX_REF_CHARS)
    );
}

fn require_unique<T: PartialEq>(items: &[T], msg: &str) {
    for (i, a) in items.iter().enumerate() {
        require!(!items[i + 1..].contains(a), msg);
    }
}

fn validate_stages(stages: &[Stage], name: &str) {
    require!(
        !stages.is_empty() && stages.len() <= MAX_STAGES,
        format!("{}: 1-10 stages required", name)
    );
    require!(
        stages.iter().all(|s| s.pct > 0),
        "Each stage must release > 0%"
    );
    require!(
        stages.iter().all(|s| s.wait_after >= MIN_TIMING_S),
        "Every stage wait must be at least 20 seconds"
    );
    let sum: u32 = stages.iter().map(|s| s.pct as u32).sum();
    require!(sum == 100, format!("{} must sum to 100", name));
}

/// The guardian checks shared by create/update_will and invite_guardian.
pub fn require_valid_guardian(g: &AccountId, owner: &AccountId, heirs: &[&AccountId]) {
    require!(g != owner, "The owner cannot be a guardian");
    // Guardian independence (threat model): a greedy heir must not count toward quorum.
    require!(!heirs.contains(&g), "A guardian cannot be an heir");
}

impl WillConfig {
    pub fn validate(&self, owner: &AccountId) {
        require!(
            !self.heirs.is_empty() && self.heirs.len() <= MAX_HEIRS,
            "1-10 heirs required"
        );
        let heir_ids: Vec<&AccountId> = self.heirs.iter().map(|h| &h.account_id).collect();
        require_unique(&heir_ids, "Duplicate heir");
        require!(!heir_ids.contains(&owner), "The owner cannot be an heir");
        for h in &self.heirs {
            require!(
                !h.name.is_empty() && h.name.chars().count() <= MAX_NAME_CHARS,
                "Heir name must be 1-64 chars"
            );
        }
        let share_sum: u32 = self.heirs.iter().map(|h| h.near_share_bps as u32).sum();
        require!(
            share_sum == BPS_TOTAL as u32,
            "NEAR shares must sum to 10000 bps"
        );

        require!(
            !self.guardians.is_empty() && self.guardians.len() <= MAX_GUARDIANS,
            "1-10 guardians required"
        );
        require_unique(&self.guardians, "Duplicate guardian");
        for g in &self.guardians {
            require_valid_guardian(g, owner, &heir_ids);
        }
        require!(
            self.guardian_threshold >= 1
                && self.guardian_threshold as usize <= self.guardians.len(),
            "Invalid guardian threshold"
        );

        require!(self.contacts.len() <= MAX_CONTACTS, "At most 10 contacts");
        require_unique(&self.contacts, "Duplicate contact");
        require!(
            !self.contacts.contains(owner),
            "The owner cannot be a contact"
        );

        if let Some(l) = &self.lawyer {
            require!(l != owner, "The owner cannot be the lawyer");
            require!(!heir_ids.contains(&l), "The lawyer cannot be an heir");
        }

        validate_stages(&self.stages, "Stages");
        validate_stages(&self.accelerated_stages, "Accelerated stages");
        require!(
            self.heirs.len() * self.stages.len().max(self.accelerated_stages.len())
                <= MAX_HEIR_STAGE_SLICES,
            "Too many heirs × stages (at most 40 slices per chain)"
        );

        let t = &self.timings;
        require!(
            [
                t.quiet_after,
                t.nudge_period,
                t.welfare_period,
                t.vote_period,
                t.challenge_period,
                t.secrets_buffer
            ]
            .iter()
            .all(|d| *d >= MIN_TIMING_S),
            "Every timing must be at least 20 seconds"
        );

        require_hex32(&self.policy_hash, "policy_hash");

        require!(
            !self.foreign_chains.contains(&Chain::Near),
            "NEAR is not a foreign chain (its vault is held by this contract)"
        );
        require_unique(&self.foreign_chains, "Duplicate foreign chain");
    }

    fn heirs(&self, previous: &[Heir]) -> Vec<Heir> {
        self.heirs
            .iter()
            .map(|h| Heir {
                account_id: h.account_id.clone(),
                name: h.name.clone(),
                near_share_bps: h.near_share_bps,
                // An heir's registered key survives a will update.
                x25519_pubkey: previous
                    .iter()
                    .find(|p| p.account_id == h.account_id)
                    .and_then(|p| p.x25519_pubkey.clone()),
            })
            .collect()
    }

    /// Invited guardians; a guardian kept from `previous` keeps its acceptance.
    fn guardians(&self, previous: &[Guardian]) -> Vec<Guardian> {
        self.guardians
            .iter()
            .map(|g| Guardian {
                account_id: g.clone(),
                accepted: previous.iter().any(|p| &p.account_id == g && p.accepted),
            })
            .collect()
    }
}

impl Will {
    fn new(owner: AccountId, cfg: WillConfig, now: u64) -> Self {
        Will {
            heirs: cfg.heirs(&[]),
            guardians: cfg.guardians(&[]),
            owner,
            guardian_threshold: cfg.guardian_threshold,
            contacts: cfg.contacts,
            stages: cfg.stages,
            accelerated_stages: cfg.accelerated_stages,
            timings: cfg.timings,
            policy_hash: cfg.policy_hash,
            foreign_chains: cfg.foreign_chains,
            lawyer: cfg.lawyer,
            heirs_hidden: cfg.heirs_hidden,
            state: WillState::Active,
            last_alive_at: now,
            created_at: now,
            attestations: vec![],
            sealed_notes: vec![],
            next_note_id: 0,
            released_notes: vec![],
            near_balance: U128(0),
            near_snapshot: U128(0),
            pending_withdrawals: vec![],
            next_withdrawal_id: 0,
            execution_round: 0,
            executions: vec![],
            stage_done: vec![],
            sign_counts: vec![],
            halted: vec![],
            accelerated: false,
            death_proofs: vec![],
            round_stages: vec![],
            round_started_at: 0,
        }
    }

    fn apply_config(&mut self, cfg: WillConfig) {
        let heirs = cfg.heirs(&self.heirs);
        for note in &self.sealed_notes {
            require!(
                heirs.iter().any(|h| h.account_id == note.heir),
                "Remove sealed notes for heirs you drop first"
            );
        }
        self.guardians = cfg.guardians(&self.guardians);
        self.heirs = heirs;
        self.guardian_threshold = cfg.guardian_threshold;
        self.contacts = cfg.contacts;
        self.stages = cfg.stages;
        self.accelerated_stages = cfg.accelerated_stages;
        self.timings = cfg.timings;
        self.policy_hash = cfg.policy_hash;
        self.foreign_chains = cfg.foreign_chains;
        self.lawyer = cfg.lawyer;
        self.heirs_hidden = cfg.heirs_hidden;
    }

    pub fn heir(&self, account: &AccountId) -> Option<&Heir> {
        self.heirs.iter().find(|h| &h.account_id == account)
    }

    pub fn require_active(&self) {
        require!(
            self.state == WillState::Active,
            "Will can only be changed while Active"
        );
    }

    pub fn guardian(&self, account: &AccountId) -> Option<&Guardian> {
        self.guardians.iter().find(|g| &g.account_id == account)
    }

    /// Panics unless `account` is a guardian who accepted.
    pub fn require_accepted_guardian(&self, account: &AccountId) {
        let g = self
            .guardian(account)
            .unwrap_or_else(|| env::panic_str("Not a guardian of this will"));
        require!(g.accepted, "Guardian has not accepted");
    }

    pub fn accepted_guardians(&self) -> usize {
        self.guardians.iter().filter(|g| g.accepted).count()
    }

    /// What the will still needs before it may escalate (empty = armed). The "strong signal
    /// source" requirement is checked off-chain: the owner's NEAR account always counts.
    pub fn armed_missing(&self) -> Vec<String> {
        let mut missing = vec![];
        let accepted = self.accepted_guardians();
        if accepted < self.guardian_threshold as usize {
            missing.push(format!(
                "{} of {} required guardians have accepted",
                accepted, self.guardian_threshold
            ));
        }
        if self.heirs.is_empty() {
            missing.push("No heir".to_string());
        }
        missing
    }

    /// Last stage of the current execution round.
    pub fn last_stage(&self) -> u8 {
        require!(!self.round_stages.is_empty(), "Will has never executed");
        (self.round_stages.len() - 1) as u8
    }

    /// True once funds may have left the vaults (no more deposits).
    pub fn execution_started(&self) -> bool {
        matches!(
            self.state,
            WillState::Executing { .. }
                | WillState::SecretsBuffer { .. }
                | WillState::SecretsReleased { .. }
                | WillState::Completed { .. }
        )
    }

    /// Switches the will to the accelerated schedule. Before execution the whole schedule is
    /// replaced when execution starts; during execution the remaining stages keep their
    /// percentages and each wait is capped at the accelerated wait, so no stage is skipped.
    pub fn accelerate(&mut self) {
        if self.accelerated {
            return;
        }
        self.accelerated = true;
        if let WillState::Executing { stage, .. } = self.state {
            let fast = &self.accelerated_stages;
            for i in stage as usize..self.round_stages.len() {
                let cap = fast[i.min(fast.len() - 1)].wait_after;
                let s = &mut self.round_stages[i];
                s.wait_after = s.wait_after.min(cap);
            }
        }
        emit(
            "will_accelerated",
            serde_json::json!({ "owner": self.owner, "round_stages": self.round_stages }),
        );
    }

    fn all_notes_released(&self) -> bool {
        self.sealed_notes
            .iter()
            .all(|n| self.released_notes.iter().any(|r| r.note_id == n.id))
    }

    pub fn is_stage_done(&self, stage: u8, chain: Chain) -> bool {
        self.stage_done.contains(&StageChain { stage, chain })
    }

    fn all_foreign_stages_done(&self) -> bool {
        (0..=self.last_stage()).all(|s| {
            self.foreign_chains
                .iter()
                .all(|c| self.is_stage_done(s, *c))
        })
    }

    fn set_state(&mut self, to: WillState, reason: &str) {
        let from = std::mem::replace(&mut self.state, to);
        emit(
            "state_changed",
            serde_json::json!({
                "owner": self.owner,
                "from": from.name(),
                "to": self.state.name(),
                "state": self.state,
                "reason": reason,
            }),
        );
    }

    /// Any sign of life: back to Active from any state before Completed. Halts execution if it
    /// was running (partial execution stays recorded). `alive_at` moves last_alive_at forward.
    pub fn reset_to_active(&mut self, reason: &str, alive_at: u64) {
        require!(
            !matches!(self.state, WillState::Completed { .. }),
            "Will already completed"
        );
        self.last_alive_at = self.last_alive_at.max(alive_at);
        let halted_stage = match self.state {
            WillState::Executing { stage, .. } => Some(stage),
            WillState::SecretsBuffer { .. } | WillState::SecretsReleased { .. } => {
                Some(self.last_stage())
            }
            _ => None,
        };
        if let Some(stage) = halted_stage {
            let halt = HaltRecord {
                round: self.execution_round,
                stage,
                at: now_s(),
                reason: reason.to_string(),
            };
            emit(
                "execution_halted",
                serde_json::json!({ "owner": self.owner, "halt": halt }),
            );
            if self.halted.len() >= MAX_HALT_RECORDS {
                self.halted.remove(0);
            }
            self.halted.push(halt);
        }
        self.attestations.clear();
        self.death_proofs.clear();
        self.accelerated = false;
        if self.state != WillState::Active {
            self.set_state(WillState::Active, reason);
        }
    }

    /// Called inside `advance` for NEAR slices, so it must not fail for a valid will: when the list
    /// is full, records of earlier rounds (already paid, kept only as history) make room. A single
    /// round can't fill it (MAX_HEIR_STAGE_SLICES).
    fn record_execution(&mut self, rec: ExecutionRecord) {
        if self.executions.len() >= MAX_EXECUTION_RECORDS {
            let round = self.execution_round;
            if let Some(i) = self.executions.iter().position(|e| e.round < round) {
                self.executions.remove(i);
            }
        }
        require!(
            self.executions.len() < MAX_EXECUTION_RECORDS,
            "Execution record limit reached"
        );
        emit(
            "execution_recorded",
            serde_json::json!({ "owner": self.owner, "record": rec }),
        );
        self.executions.push(rec);
    }
}

impl Contract {
    pub(crate) fn will(&self, owner: &AccountId) -> Will {
        self.wills
            .get(owner)
            .cloned()
            .unwrap_or_else(|| env::panic_str("No will for this owner"))
    }

    pub(crate) fn save(&mut self, will: Will) {
        self.wills.insert(will.owner.clone(), will);
    }

    /// Charges the caller for storage added since `initial_usage` out of `attached`, refunding
    /// the rest. If storage shrank, the freed bytes are refunded too.
    pub(crate) fn settle_storage(
        &self,
        payer: &AccountId,
        initial_usage: u64,
        attached: NearToken,
    ) {
        let byte_cost = env::storage_byte_cost().as_yoctonear();
        let usage = env::storage_usage();
        let attached = attached.as_yoctonear();
        let refund = if usage > initial_usage {
            let cost = (usage - initial_usage) as u128 * byte_cost;
            require!(
                attached >= cost,
                format!("Attach at least {} yoctoNEAR for storage", cost)
            );
            attached - cost
        } else {
            attached + (initial_usage - usage) as u128 * byte_cost
        };
        if refund > 0 {
            Promise::new(payer.clone())
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
    }

    /// Sends NEAR out of a will's vault. The vault is debited now; a failed transfer is re-credited
    /// by `on_near_transfer`.
    pub(crate) fn pay_out_near(&mut self, will: &mut Will, to: AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        will.near_balance = U128(will.near_balance.0 - amount);
        self.total_vault_near -= amount;
        Promise::new(to)
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_near_transfer(will.owner.clone(), U128(amount)),
            )
            .detach();
    }

    /// Releases stage `stage` of the NEAR vault, split across heirs by near_share_bps.
    /// The last stage releases everything left, so rounding dust never stays behind.
    fn release_near_stage(&mut self, will: &mut Will, stage: u8) {
        let amount = if stage == will.last_stage() {
            will.near_balance.0
        } else {
            will.near_snapshot.0 * will.round_stages[stage as usize].pct as u128 / 100
        }
        .min(will.near_balance.0);
        if amount == 0 {
            return;
        }
        let paid_heirs: Vec<Heir> = will
            .heirs
            .iter()
            .filter(|h| h.near_share_bps > 0)
            .cloned()
            .collect();
        let mut remaining = amount;
        for (i, heir) in paid_heirs.iter().enumerate() {
            let share = if i == paid_heirs.len() - 1 {
                remaining
            } else {
                amount * heir.near_share_bps as u128 / BPS_TOTAL as u128
            };
            remaining -= share;
            if share == 0 {
                continue;
            }
            self.pay_out_near(will, heir.account_id.clone(), share);
            will.record_execution(ExecutionRecord {
                round: will.execution_round,
                stage,
                chain: Chain::Near,
                to: heir.account_id.to_string(),
                amount: share.to_string(),
                tx_hash: String::new(),
                at: now_s(),
            });
        }
    }

    fn start_stage(&mut self, will: &mut Will, stage: u8, since: u64, now: u64) {
        will.set_state(
            WillState::Executing {
                stage,
                since,
                stage_started: now,
            },
            "stage_due",
        );
        self.release_near_stage(will, stage);
    }

    /// Moves the will one step along the escalation ladder if the current period has elapsed.
    /// Returns whether the state changed.
    pub(crate) fn internal_advance(&mut self, will: &mut Will, now: u64) -> bool {
        let t = will.timings.clone();
        let elapsed = |since: u64| now.saturating_sub(since);
        match will.state.clone() {
            WillState::Active
                if elapsed(will.last_alive_at) >= t.quiet_after
                    && will.armed_missing().is_empty() =>
            {
                will.set_state(WillState::Quiet { since: now }, "silence");
            }
            WillState::Quiet { since } if elapsed(since) >= t.nudge_period => {
                will.set_state(WillState::WelfareCheck { since: now }, "nudge_unanswered");
            }
            WillState::WelfareCheck { since } if elapsed(since) >= t.welfare_period => {
                will.attestations.clear();
                will.set_state(WillState::GuardianVote { since: now }, "welfare_unanswered");
            }
            WillState::GuardianVote { since } if elapsed(since) >= t.vote_period => {
                // Quorum not reached in time (reaching it moves to Challenge immediately).
                emit("vote_failed", serde_json::json!({ "owner": will.owner }));
                // Same clean-up as any return to Active, but last_alive_at stays: the owner is
                // still silent, so the ladder restarts (Decision log 2026-10-27 (8)).
                will.attestations.clear();
                will.death_proofs.clear();
                will.accelerated = false;
                will.set_state(WillState::Active, "vote_failed");
            }
            WillState::Challenge { since } if elapsed(since) >= t.challenge_period => {
                will.execution_round += 1;
                will.round_stages = if will.accelerated {
                    will.accelerated_stages.clone()
                } else {
                    will.stages.clone()
                };
                will.round_started_at = now;
                will.near_snapshot = will.near_balance;
                will.stage_done.clear();
                will.sign_counts.clear();
                self.start_stage(will, 0, now, now);
            }
            WillState::Executing {
                stage,
                since,
                stage_started,
            } if elapsed(stage_started) >= will.round_stages[stage as usize].wait_after => {
                if stage < will.last_stage() {
                    self.start_stage(will, stage + 1, since, now);
                } else if will.all_foreign_stages_done() {
                    will.set_state(WillState::SecretsBuffer { since: now }, "distribution_done");
                } else {
                    return false;
                }
            }
            WillState::SecretsBuffer { since } if elapsed(since) >= t.secrets_buffer => {
                will.set_state(WillState::SecretsReleased { since: now }, "buffer_passed");
            }
            WillState::SecretsReleased { .. } if will.all_notes_released() => {
                will.set_state(WillState::Completed { at: now }, "secrets_released");
            }
            _ => return false,
        }
        true
    }
}
