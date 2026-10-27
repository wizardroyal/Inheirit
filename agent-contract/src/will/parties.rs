//! Methods for guardians, welfare contacts, heirs, and anyone (advance).
use super::*;

#[near]
impl Contract {
    /// Guardian attestation, only during GuardianVote. One `Alive` returns the will to Active;
    /// `Deceased` attestations reaching the threshold start the Challenge period.
    pub fn attest(&mut self, owner: AccountId, kind: AttestKind, evidence_hash: Option<String>) {
        let guardian = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            will.guardians.contains(&guardian),
            "Not a guardian of this will"
        );
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

    /// A welfare contact confirms the owner is fine. Can only delay, so it is limited to the
    /// early states (Quiet, WelfareCheck).
    pub fn contact_confirm_alive(&mut self, owner: AccountId) {
        let contact = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(
            will.contacts.contains(&contact),
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
