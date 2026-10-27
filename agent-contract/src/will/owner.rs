//! Methods the will owner calls. The caller is always the owner of the will they act on.
use super::*;

#[near]
impl Contract {
    #[payable]
    pub fn create_will(&mut self, config: WillConfig) {
        let owner = env::predecessor_account_id();
        require!(self.wills.get(&owner).is_none(), "Will already exists");
        config.validate(&owner);
        let initial = env::storage_usage();
        let will = Will::new(owner.clone(), config, now_s());
        emit(
            "will_created",
            serde_json::json!({ "owner": owner, "policy_hash": will.policy_hash }),
        );
        self.save(will);
        self.wills.flush();
        self.settle_storage(&owner, initial, env::attached_deposit());
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

    /// Adds the attached NEAR to the will's NEAR vault. Closed once execution starts.
    #[payable]
    pub fn deposit_near(&mut self) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            !matches!(
                will.state,
                WillState::Executing { .. } | WillState::Completed { .. }
            ),
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
}
