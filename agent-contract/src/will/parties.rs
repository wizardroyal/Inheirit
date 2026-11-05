//! Methods for guardians, welfare contacts, heirs, and anyone (advance).
use super::*;

#[near]
impl Contract {
    /// Guardian attestation, only during GuardianVote. One `Alive` returns the will to Active;
    /// `Deceased` attestations reaching the threshold start the Challenge period.
    pub fn attest(&mut self, owner: AccountId, kind: AttestKind, evidence_hash: Option<String>) {
        let guardian = env::predecessor_account_id();
        let mut will = self.will(&owner);
        will.require_accepted_guardian(&guardian);
        require!(
            matches!(will.state, WillState::GuardianVote { .. }),
            "Attestations are accepted only during GuardianVote"
        );
        require!(
            !will.attestations.iter().any(|a| a.guardian == guardian),
            "Already attested in this vote"
        );
        if let Some(h) = &evidence_hash {
            require_hex32(h, "evidence_hash");
        }
        let now = now_s();
        let attestation = GuardianAttestation {
            guardian,
            kind,
            evidence_hash,
            at: now,
        };
        emit(
            "guardian_attested",
            serde_json::json!({ "owner": owner, "attestation": attestation }),
        );
        match kind {
            AttestKind::Alive => will.reset_to_active("guardian_alive", now),
            AttestKind::Deceased => {
                will.attestations.push(attestation);
                let deceased = will
                    .attestations
                    .iter()
                    .filter(|a| a.kind == AttestKind::Deceased)
                    .count();
                if deceased >= will.guardian_threshold as usize {
                    will.set_state(WillState::Challenge { since: now }, "guardian_quorum");
                }
            }
        }
        self.save(will);
    }

    /// An invited guardian accepts the role. Only accepted guardians count toward the quorum.
    pub fn accept_guardian(&mut self, owner: AccountId) {
        let guardian = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            !matches!(will.state, WillState::Completed { .. }),
            "Will already completed"
        );
        let entry = will
            .guardians
            .iter_mut()
            .find(|g| g.account_id == guardian)
            .unwrap_or_else(|| env::panic_str("Not a guardian of this will"));
        require!(!entry.accepted, "Already accepted");
        entry.accepted = true;
        emit(
            "guardian_accepted",
            serde_json::json!({ "owner": owner, "guardian": guardian }),
        );
        self.save(will);
    }

    /// Evidence of death that speeds up the remaining release (CLAUDE.md §5.5). The lawyer's
    /// proof alone, or proofs from a quorum of accepted guardians, switch the will to the
    /// accelerated schedule. It never skips the vote, the challenge period or a stage.
    pub fn attest_death_proof(&mut self, owner: AccountId, evidence_hash: String) {
        let by = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require_hex32(&evidence_hash, "evidence_hash");
        require!(
            matches!(
                will.state,
                WillState::GuardianVote { .. }
                    | WillState::Challenge { .. }
                    | WillState::Executing { .. }
            ),
            "Death proofs are accepted only in GuardianVote, Challenge or Executing"
        );
        let is_lawyer = will.lawyer.as_ref() == Some(&by);
        if !is_lawyer {
            if will.guardian(&by).is_none() {
                env::panic_str("Only the lawyer or a guardian can attest a death proof");
            }
            will.require_accepted_guardian(&by);
        }
        require!(
            !will.death_proofs.iter().any(|p| p.by == by),
            "Already submitted a death proof"
        );
        require!(
            will.death_proofs.len() < MAX_DEATH_PROOFS,
            "Death proof limit reached"
        );
        let proof = DeathProof {
            by,
            evidence_hash,
            at: now_s(),
        };
        emit(
            "death_proof_attested",
            serde_json::json!({ "owner": owner, "proof": proof, "lawyer": is_lawyer }),
        );
        will.death_proofs.push(proof);
        let guardian_proofs = will
            .death_proofs
            .iter()
            .filter(|p| will.guardian(&p.by).is_some_and(|g| g.accepted))
            .count();
        if is_lawyer || guardian_proofs >= will.guardian_threshold as usize {
            will.accelerate();
        }
        self.save(will);
    }

    /// Someone in the welfare chain (a contact, an accepted guardian or the lawyer) confirms the
    /// owner is fine. Can only delay, so it is limited to the early states (Quiet, WelfareCheck).
    pub fn contact_confirm_alive(&mut self, owner: AccountId) {
        let contact = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            will.contacts.contains(&contact)
                || will.guardian(&contact).is_some_and(|g| g.accepted)
                || will.lawyer.as_ref() == Some(&contact),
            "Not a contact of this will"
        );
        require!(
            matches!(
                will.state,
                WillState::Quiet { .. } | WillState::WelfareCheck { .. }
            ),
            "Contacts can confirm only in Quiet or WelfareCheck"
        );
        let now = now_s();
        emit(
            "contact_confirmed_alive",
            serde_json::json!({ "owner": owner, "contact": contact }),
        );
        will.reset_to_active("contact_alive", now);
        self.save(will);
    }

    /// Called by the heir's own account to register the X25519 key notes are re-sealed to.
    /// Cannot change once a note has been released to this heir.
    pub fn register_heir_key(&mut self, owner: AccountId, x25519_pubkey: String) {
        let heir = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require_hex32(&x25519_pubkey, "x25519_pubkey");
        require!(
            !will.released_notes.iter().any(|n| n.heir == heir),
            "Key is fixed once notes are released to it"
        );
        let entry = will
            .heirs
            .iter_mut()
            .find(|h| h.account_id == heir)
            .unwrap_or_else(|| env::panic_str("Not an heir of this will"));
        entry.x25519_pubkey = Some(x25519_pubkey.clone());
        emit(
            "heir_key_registered",
            serde_json::json!({ "owner": owner, "heir": heir, "x25519_pubkey": x25519_pubkey }),
        );
        self.save(will);
    }

    /// Anyone may move a will forward one step once its current period has elapsed.
    /// NEAR stage releases happen here. Returns whether the state changed.
    pub fn advance(&mut self, owner: AccountId) -> bool {
        let mut will = self.will(&owner);
        let changed = self.internal_advance(&mut will, now_s());
        if changed {
            self.save(will);
        }
        changed
    }
}
