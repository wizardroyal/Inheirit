//! Methods only a registered agent (valid attestation, approved measurements) may call.
use super::*;

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignPurpose {
    /// Release of `stage` on the requested chain; only while Executing.
    Release { stage: u8 },
    /// The owner's pending withdrawal `id`; only while Active.
    Withdrawal { id: u32 },
}

impl Contract {
    /// Panics unless the caller is a registered agent that is currently valid.
    fn require_agent(&self) {
        let account_id = env::predecessor_account_id();
        let agent = self
            .agents
            .get(&account_id)
            .unwrap_or_else(|| env::panic_str("Agent not registered"));
        let reasons = self.check_invalid_reasons(&account_id, agent);
        require!(reasons.is_empty(), format!("Invalid agent: {:?}", reasons));
    }
}

#[near]
impl Contract {
    /// The agent's scored "alive" time for `owner` (CLAUDE.md §7.2). Moves last_alive_at forward;
    /// if `at` is newer than when the current escalation state began, the will returns to Active
    /// (halting execution if it was running). Returns whether anything changed.
    pub fn record_liveness(&mut self, owner: AccountId, at: u64) -> bool {
        self.require_agent();
        require!(at <= now_s(), "Liveness time is in the future");
        let mut will = self.will(&owner);
        if at <= will.last_alive_at || matches!(will.state, WillState::Completed { .. }) {
            return false;
        }
        emit(
            "liveness_recorded",
            serde_json::json!({ "owner": owner, "at": at, "source": "agent" }),
        );
        match will.liveness_cutoff() {
            Some(cutoff) if at > cutoff => will.reset_to_active("signal_alive", at),
            _ => will.last_alive_at = at,
        }
        self.save(will);
        true
    }

    /// Publishes the TEE's sealed-notes X25519 key. A registered agent can set it only once;
    /// replacing it is a deliberate rotation by the contract owner (CLAUDE.md §7.5).
    pub fn set_agent_pubkey(&mut self, x25519_pubkey: String, app_id: String) {
        self.require_agent();
        require!(
            self.agent_key.is_none(),
            "Agent key already set; the contract owner must rotate it"
        );
        self.internal_set_agent_key(x25519_pubkey, app_id);
    }

    pub fn rotate_agent_pubkey(&mut self, x25519_pubkey: String, app_id: String) {
        self.require_owner();
        self.internal_set_agent_key(x25519_pubkey, app_id);
    }

    /// The only way to get an MPC signature from this contract. Gated by the will's state:
    /// releases only while Executing (for a reached, unfinished stage), withdrawals only while
    /// Active and only for a pending owner withdrawal. The derivation path is always the will's
    /// own vault path for `chain`; the agent cannot choose it.
    pub fn request_signature(
        &mut self,
        owner: AccountId,
        chain: Chain,
        payload: String,
        purpose: SignPurpose,
    ) -> Promise {
        // Template behaviour: an invalid agent is removed and the call fails via a promise.
        if let Some(failure) = self.require_valid_agent() {
            return failure;
        }
        require_hex32(&payload, "Payload");
        let mut will = self.will(&owner);
        require!(
            chain != Chain::Near && will.foreign_chains.contains(&chain),
            "Chain has no vault in this will"
        );
        match purpose {
            SignPurpose::Release { stage } => {
                let current = match will.state {
                    WillState::Executing { stage, .. } => stage,
                    _ => env::panic_str("Release signatures only while Executing"),
                };
                require!(stage <= current, "Stage not reached");
                require!(
                    !will.is_stage_done(stage, chain),
                    "Stage already done for this chain"
                );
                let entry = match will
                    .sign_counts
                    .iter_mut()
                    .find(|c| c.stage == stage && c.chain == chain)
                {
                    Some(c) => c,
                    None => {
                        will.sign_counts.push(SignCount {
                            stage,
                            chain,
                            count: 0,
                        });
                        will.sign_counts.last_mut().unwrap()
                    }
                };
                require!(
                    entry.count < MAX_SIGNATURES_PER_STAGE_CHAIN,
                    "Signature limit for this stage reached"
                );
                entry.count += 1;
            }
            SignPurpose::Withdrawal { id } => {
                require!(
                    will.state == WillState::Active,
                    "Withdrawal signatures only while Active"
                );
                let w = will
                    .pending_withdrawals
                    .iter_mut()
                    .find(|w| w.id == id)
                    .unwrap_or_else(|| env::panic_str("No such pending withdrawal"));
                require!(w.chain == chain, "Withdrawal is for another chain");
                require!(
                    w.signatures < MAX_SIGNATURES_PER_WITHDRAWAL,
                    "Signature limit for this withdrawal reached"
                );
                w.signatures += 1;
            }
        }
        let path = vault_path(&owner, chain);
        emit(
            "signature_requested",
            serde_json::json!({ "owner": owner, "chain": chain, "purpose": purpose, "path": path }),
        );
        self.save(will);
        self.internal_request_signature(path, payload, "Ecdsa".to_string())
    }

    /// Records a foreign-chain transfer the agent broadcast for the current execution round.
    pub fn record_execution(
        &mut self,
        owner: AccountId,
        stage: u8,
        chain: Chain,
        to: String,
        amount: String,
        tx_hash: String,
    ) {
        self.require_agent();
        let mut will = self.will(&owner);
        require!(
            chain != Chain::Near,
            "NEAR releases are recorded by the contract"
        );
        require!(will.execution_round > 0, "Will has never executed");
        require!(stage <= will.last_stage(), "No such stage");
        require_ref(&to, "to");
        require_ref(&amount, "amount");
        require_ref(&tx_hash, "tx_hash");
        // Allowed after a halt too: a tx signed just before the owner returned can still land,
        // and the history should show it.
        let rec = ExecutionRecord {
            round: will.execution_round,
            stage,
            chain,
            to,
            amount,
            tx_hash,
            at: now_s(),
        };
        will.record_execution(rec);
        self.save(will);
    }

    /// The agent has finished `stage` on `chain` (including "nothing to send").
    pub fn mark_stage_done(&mut self, owner: AccountId, stage: u8, chain: Chain) {
        self.require_agent();
        let mut will = self.will(&owner);
        let current = match will.state {
            WillState::Executing { stage, .. } => stage,
            _ => env::panic_str("Stages are marked done only while Executing"),
        };
        require!(stage <= current, "Stage not reached");
        require!(
            chain != Chain::Near && will.foreign_chains.contains(&chain),
            "Chain has no vault in this will"
        );
        if !will.is_stage_done(stage, chain) {
            will.stage_done.push(StageChain { stage, chain });
            emit(
                "stage_done",
                serde_json::json!({ "owner": owner, "round": will.execution_round, "stage": stage, "chain": chain }),
            );
            self.save(will);
        }
    }

    pub fn complete_withdrawal(&mut self, owner: AccountId, id: u32, tx_hash: String) {
        self.require_agent();
        require_ref(&tx_hash, "tx_hash");
        let mut will = self.will(&owner);
        let idx = will
            .pending_withdrawals
            .iter()
            .position(|w| w.id == id)
            .unwrap_or_else(|| env::panic_str("No such pending withdrawal"));
        let w = will.pending_withdrawals.remove(idx);
        emit(
            "withdrawal_completed",
            serde_json::json!({ "owner": owner, "withdrawal": w, "tx_hash": tx_hash }),
        );
        self.save(will);
    }

    /// Stores a sealed note re-encrypted by the agent to the heir's registered key.
    pub fn store_released_note(
        &mut self,
        owner: AccountId,
        note_id: u32,
        heir: AccountId,
        ciphertext: Base64VecU8,
    ) {
        self.require_agent();
        let mut will = self.will(&owner);
        // Secrets last (CLAUDE.md §5.5): only after distribution and the buffer.
        require!(
            matches!(will.state, WillState::SecretsReleased { .. }),
            "Notes are released only in SecretsReleased"
        );
        let note = will
            .sealed_notes
            .iter()
            .find(|n| n.id == note_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("No such sealed note"));
        require!(note.heir == heir, "Note is for another heir");
        require!(
            will.heir(&heir)
                .and_then(|h| h.x25519_pubkey.as_ref())
                .is_some(),
            "Heir has not registered a key"
        );
        require!(
            !will.released_notes.iter().any(|n| n.note_id == note_id),
            "Note already released"
        );
        require!(
            !ciphertext.0.is_empty() && ciphertext.0.len() <= MAX_RELEASED_NOTE_BYTES,
            "Released ciphertext size invalid"
        );
        emit(
            "note_released",
            serde_json::json!({ "owner": owner, "note_id": note_id, "heir": heir }),
        );
        will.released_notes.push(ReleasedNote {
            note_id,
            heir,
            label: note.label,
            ciphertext,
            at: now_s(),
        });
        self.save(will);
    }
}

impl Contract {
    fn internal_set_agent_key(&mut self, x25519_pubkey: String, app_id: String) {
        require_hex32(&x25519_pubkey, "x25519_pubkey");
        require_ref(&app_id, "app_id");
        let key = AgentKey {
            x25519_pubkey,
            app_id,
            set_at: now_s(),
        };
        emit("agent_key_set", serde_json::json!({ "key": key }));
        self.agent_key = Some(key);
    }
}
