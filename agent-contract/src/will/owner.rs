//! Methods the will owner calls. The caller is always the owner of the will they act on.
use super::*;

#[near]
impl Contract {
    #[payable]
    pub fn create_will(&mut self, config: WillConfig) {
        let owner = env::predecessor_account_id();
        // "Start over" (§13A.1): an owner may replace their own Completed will, never one still running.
        let previous = self.wills.get(&owner).cloned();
        if let Some(old) = &previous {
            require!(
                matches!(old.state, WillState::Completed { .. }),
                "Will already exists"
            );
        }
        config.validate(&owner);
        let initial = env::storage_usage();
        let mut will = Will::new(owner.clone(), config, now_s());
        if let Some(old) = &previous {
            // NEAR credited back after a failed payout stays the owner's; the agent keys executions and
            // payouts by round and notes by id, so numbering continues instead of restarting.
            will.near_balance = old.near_balance;
            will.execution_round = old.execution_round;
            will.next_note_id = old.next_note_id;
            // Notes already released to heirs stay readable: an heir may not have opened them yet.
            // At most the latest MAX_NOTES: repeated Start overs must not grow contract-paid storage forever.
            let keep = old.released_notes.len().saturating_sub(MAX_NOTES);
            will.released_notes = old.released_notes[keep..].to_vec();
        } else if let Some(raw) = env::storage_read(&closed_key(&owner)) {
            // A will this owner closed earlier: keep counting rounds and note ids from where it stopped.
            let (round, next_note): (u32, u32) = near_sdk::borsh::from_slice(&raw).expect("closed record");
            will.execution_round = round;
            will.next_note_id = next_note;
        }
        emit(
            "will_created",
            serde_json::json!({
                "owner": owner,
                "policy_hash": will.policy_hash,
                "replaced_completed": previous.is_some(),
            }),
        );
        self.save(will);
        self.wills.flush();
        // A replaced will freed records the contract paid for (executions, attestations, released
        // notes); the owner pays for growth but is never refunded below the old usage.
        let base = if previous.is_some() { initial.min(env::storage_usage()) } else { initial };
        self.settle_storage(&owner, base, env::attached_deposit());
    }

    /// Replaces the will's configuration. Only while Active; registered heir keys are kept.
    #[payable]
    pub fn update_will(&mut self, config: WillConfig) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        will.require_active();
        config.validate(&owner);
        let initial = env::storage_usage();
        will.apply_config(config);
        will.last_alive_at = now_s();
        emit(
            "will_updated",
            serde_json::json!({ "owner": owner, "policy_hash": will.policy_hash }),
        );
        self.save(will);
        self.wills.flush();
        self.settle_storage(&owner, initial, env::attached_deposit());
    }

    /// Invites one more guardian. It counts only after it calls accept_guardian. Only while Active.
    #[payable]
    pub fn invite_guardian(&mut self, account: AccountId) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            will.state == WillState::Active,
            "Guardians can be invited only while Active"
        );
        require!(will.guardian(&account).is_none(), "Duplicate guardian");
        require!(will.guardians.len() < MAX_GUARDIANS, "At most 10 guardians");
        let heirs: Vec<&AccountId> = will.heirs.iter().map(|h| &h.account_id).collect();
        require_valid_guardian(&account, &owner, &heirs);
        let initial = env::storage_usage();
        will.guardians.push(Guardian {
            account_id: account.clone(),
            accepted: false,
        });
        will.last_alive_at = now_s();
        emit(
            "guardian_invited",
            serde_json::json!({ "owner": owner, "guardian": account }),
        );
        self.save(will);
        self.wills.flush();
        self.settle_storage(&owner, initial, env::attached_deposit());
    }

    /// Removes a guardian (invited or accepted). Only while Active, and never below the threshold.
    pub fn remove_guardian(&mut self, account: AccountId) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            will.state == WillState::Active,
            "Guardians can be removed only while Active"
        );
        require!(
            will.guardian(&account).is_some(),
            "Not a guardian of this will"
        );
        require!(
            will.guardians.len() > will.guardian_threshold as usize,
            "That would leave fewer guardians than the threshold"
        );
        let initial = env::storage_usage();
        will.guardians.retain(|g| g.account_id != account);
        will.last_alive_at = now_s();
        emit(
            "guardian_removed",
            serde_json::json!({ "owner": owner, "guardian": account }),
        );
        self.save(will);
        self.wills.flush();
        self.settle_storage(&owner, initial, NearToken::from_yoctonear(0));
    }

    /// Adds the attached NEAR to the will's NEAR vault. Closed once execution starts.
    #[payable]
    pub fn deposit_near(&mut self) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            !will.execution_started(),
            "Vault deposits are closed once execution starts"
        );
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach the NEAR to deposit");
        will.near_balance = U128(will.near_balance.0 + amount);
        self.total_vault_near += amount;
        emit(
            "near_deposited",
            serde_json::json!({ "owner": owner, "amount": U128(amount), "balance": will.near_balance }),
        );
        self.save(will);
    }

    /// The owner's direct sign of life: back to Active from any state before Completed.
    /// During execution this halts the remaining stages.
    pub fn i_am_alive(&mut self) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        let now = now_s();
        will.reset_to_active("owner_alive", now);
        emit(
            "liveness_recorded",
            serde_json::json!({ "owner": owner, "at": now, "source": "owner" }),
        );
        self.save(will);
    }

    #[payable]
    pub fn add_sealed_note(
        &mut self,
        heir: AccountId,
        label: String,
        ciphertext: Base64VecU8,
    ) -> u32 {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        will.require_active();
        require!(will.heir(&heir).is_some(), "Not an heir of this will");
        require!(
            !label.is_empty() && label.chars().count() <= MAX_LABEL_CHARS,
            "Label must be 1-64 chars"
        );
        require!(!ciphertext.0.is_empty(), "Empty ciphertext");
        require!(
            ciphertext.0.len() <= MAX_NOTE_CIPHERTEXT_BYTES,
            "Ciphertext too large"
        );
        require!(
            will.sealed_notes.len() < MAX_NOTES,
            "Sealed note limit reached"
        );
        let initial = env::storage_usage();
        let id = will.next_note_id;
        will.next_note_id += 1;
        will.sealed_notes.push(SealedNote {
            id,
            heir: heir.clone(),
            label,
            ciphertext,
            created_at: now_s(),
        });
        will.last_alive_at = now_s();
        emit(
            "sealed_note_added",
            serde_json::json!({ "owner": owner, "note_id": id, "heir": heir }),
        );
        self.save(will);
        self.wills.flush();
        self.settle_storage(&owner, initial, env::attached_deposit());
        id
    }

    pub fn remove_sealed_note(&mut self, note_id: u32) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        will.require_active();
        let before = will.sealed_notes.len();
        will.sealed_notes.retain(|n| n.id != note_id);
        require!(will.sealed_notes.len() < before, "No such sealed note");
        let initial = env::storage_usage();
        will.last_alive_at = now_s();
        emit(
            "sealed_note_removed",
            serde_json::json!({ "owner": owner, "note_id": note_id }),
        );
        self.save(will);
        self.wills.flush();
        self.settle_storage(&owner, initial, NearToken::from_yoctonear(0));
    }

    /// Withdraws from a vault while Active. NEAR is sent now; Eth/Btc withdrawals are queued for
    /// the agent, which may then request signatures for exactly this withdrawal.
    pub fn request_withdrawal(&mut self, chain: Chain, to: String, amount: U128) -> Option<u32> {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            will.state == WillState::Active,
            "Withdrawals only while Active"
        );
        require!(amount.0 > 0, "Amount must be > 0");
        require_ref(&to, "to");
        will.last_alive_at = now_s();
        let id = if chain == Chain::Near {
            let to_account: AccountId = to
                .parse()
                .unwrap_or_else(|_| env::panic_str("Invalid NEAR account"));
            require!(
                amount.0 <= will.near_balance.0,
                "Insufficient NEAR in vault"
            );
            self.pay_out_near(&mut will, to_account, amount.0);
            None
        } else {
            require!(
                will.foreign_chains.contains(&chain),
                "Chain has no vault in this will"
            );
            require!(
                will.pending_withdrawals.len() < MAX_PENDING_WITHDRAWALS,
                "Too many pending withdrawals"
            );
            let id = will.next_withdrawal_id;
            will.next_withdrawal_id += 1;
            will.pending_withdrawals.push(Withdrawal {
                id,
                chain,
                to: to.clone(),
                amount,
                created_at: now_s(),
                signatures: 0,
            });
            Some(id)
        };
        emit(
            "withdrawal_requested",
            serde_json::json!({ "owner": owner, "id": id, "chain": chain, "to": to, "amount": amount }),
        );
        self.save(will);
        id
    }

    pub fn cancel_withdrawal(&mut self, id: u32) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        let before = will.pending_withdrawals.len();
        will.pending_withdrawals.retain(|w| w.id != id);
        require!(
            will.pending_withdrawals.len() < before,
            "No such pending withdrawal"
        );
        emit(
            "withdrawal_cancelled",
            serde_json::json!({ "owner": owner, "id": id }),
        );
        self.save(will);
    }

    /// Re-credits the vault if a NEAR transfer (withdrawal or release) failed.
    #[private]
    pub fn on_near_transfer(
        &mut self,
        owner: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_ok() {
            return;
        }
        let mut will = self.will(&owner);
        will.near_balance = U128(will.near_balance.0 + amount.0);
        self.total_vault_near += amount.0;
        emit(
            "near_transfer_failed",
            serde_json::json!({ "owner": owner, "amount": amount }),
        );
        self.save(will);
    }

    /// Closes the caller's will for good: only at All good, never with a withdrawal still being sent.
    /// The NEAR vault and the will's storage deposit go back to the owner; sealed notes are dropped.
    /// The contract can't see Sepolia or Bitcoin balances, so the app checks those vaults are empty
    /// before it offers this (coins left there could no longer be withdrawn through the will).
    pub fn close_will(&mut self) {
        let owner = env::predecessor_account_id();
        let will = self.will(&owner);
        require!(will.state == WillState::Active, "A will can be closed only at All good");
        require!(will.pending_withdrawals.is_empty(), "A withdrawal is still being sent; wait for it first");
        let vault = will.near_balance.0;
        let initial = env::storage_usage();
        // The agent keys executions and payouts by round and notes by id: a later will continues them.
        env::storage_write(&closed_key(&owner), &near_sdk::borsh::to_vec(&(will.execution_round, will.next_note_id)).unwrap());
        self.wills.remove(&owner);
        self.wills.flush();
        self.total_vault_near -= vault;
        emit("will_closed", serde_json::json!({ "owner": owner, "near_returned": vault.to_string(), "notes_dropped": will.sealed_notes.len() }));
        // Freed storage is refunded by settle_storage; the vault goes back in the same transfer batch.
        if vault > 0 {
            Promise::new(owner.clone()).transfer(NearToken::from_yoctonear(vault)).detach();
        }
        self.settle_storage(&owner, initial, NearToken::from_yoctonear(0));
    }
}

/// Raw storage key for a closed will's counters (outside the `Contract` struct: no layout change).
fn closed_key(owner: &AccountId) -> Vec<u8> {
    format!("closed:{owner}").into_bytes()
}
