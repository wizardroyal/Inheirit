//! Invite links (judge feedback, Nov 12): an owner adds a guardian, friend or lawyer who has no NEAR
//! account yet. The owner stores sha256(code) for a role; whoever opens the link signs in (an app-made
//! account is fine) and claims it with the code. Single use, with an expiry.
//!
//! Invites live under their own raw storage keys (`inv:<owner>:<hash>`), outside the `Contract` struct,
//! so adding this feature doesn't change the stored layout: a code-only upgrade, no wipe.
use super::*;
use near_sdk::borsh;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Invite {
    pub role: String,
    /// Unix seconds.
    pub expires_at: u64,
}

const ROLES: [&str; 3] = ["guardian", "friend", "lawyer"];
/// An invite lasts between a minute and 30 days.
const MIN_TTL_S: u64 = 60;
const MAX_TTL_S: u64 = 30 * 86_400;

fn invite_key(owner: &AccountId, code_hash: &str) -> Vec<u8> {
    format!("inv:{owner}:{code_hash}").into_bytes()
}

fn read_invite(owner: &AccountId, code_hash: &str) -> Option<Invite> {
    env::storage_read(&invite_key(owner, code_hash)).map(|b| borsh::from_slice(&b).expect("invite record"))
}

#[near]
impl Contract {
    /// Owner only, while Active: stores an invite for `role` under sha256(code) (hex), valid `ttl_s`
    /// seconds. Attach a little NEAR for its storage (unused deposit is refunded).
    #[payable]
    pub fn create_invite(&mut self, role: String, code_hash: String, ttl_s: u64) {
        let owner = env::predecessor_account_id();
        let mut will = self.will(&owner);
        require!(will.state == WillState::Active, "Invites can be made only while Active");
        require!(ROLES.contains(&role.as_str()), "Unknown role: use guardian, friend or lawyer");
        require!(code_hash.len() == 64 && code_hash.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "code_hash must be 64 lowercase hex characters");
        require!((MIN_TTL_S..=MAX_TTL_S).contains(&ttl_s), "An invite lasts between 1 minute and 30 days");
        let initial = env::storage_usage();
        let record = Invite { role: role.clone(), expires_at: now_s() + ttl_s };
        let existed = env::storage_write(&invite_key(&owner, &code_hash), &borsh::to_vec(&record).unwrap());
        require!(!existed, "That invite already exists");
        will.last_alive_at = now_s();
        emit("invite_created", serde_json::json!({ "owner": owner, "role": role, "expires_at": record.expires_at }));
        self.save(will);
        self.wills.flush();
        self.settle_storage(&owner, initial, env::attached_deposit());
    }

    /// Owner only: withdraws an unused invite (its storage is refunded).
    pub fn cancel_invite(&mut self, code_hash: String) {
        let owner = env::predecessor_account_id();
        let initial = env::storage_usage();
        require!(env::storage_remove(&invite_key(&owner, &code_hash)), "Invite not found or already used");
        self.settle_storage(&owner, initial, NearToken::from_yoctonear(0));
    }

    /// The caller takes the invited role on `owner`'s will: an accepted guardian, a friend, or the lawyer.
    /// Single use; only while the will is Active; the usual rules for each role apply.
    pub fn claim_invite(&mut self, owner: AccountId, code: String) {
        let caller = env::predecessor_account_id();
        let code_hash = hex::encode(env::sha256(code.as_bytes()));
        let invite = read_invite(&owner, &code_hash).unwrap_or_else(|| env::panic_str("Invite not found or already used"));
        require!(now_s() <= invite.expires_at, "This invite has expired");
        let mut will = self.will(&owner);
        require!(will.state == WillState::Active, "Invites can be claimed only while Active");
        let initial = env::storage_usage();
        env::storage_remove(&invite_key(&owner, &code_hash));
        let heirs: Vec<&AccountId> = will.heirs.iter().map(|h| &h.account_id).collect();
        match invite.role.as_str() {
            "guardian" => {
                require_valid_guardian(&caller, &owner, &heirs);
                require!(will.guardian(&caller).is_none(), "Already a guardian of this will");
                require!(will.guardians.len() < MAX_GUARDIANS, "At most 10 guardians");
                // Claiming the invite is accepting the role.
                will.guardians.push(Guardian { account_id: caller.clone(), accepted: true });
            }
            "friend" => {
                require!(caller != owner, "The owner cannot be their own friend contact");
                require!(!will.contacts.contains(&caller), "Already a friend contact of this will");
                require!(will.contacts.len() < MAX_CONTACTS, "At most 10 contacts");
                will.contacts.push(caller.clone());
            }
            _ => {
                require!(will.lawyer.is_none(), "This will already names a lawyer");
                require!(caller != owner && !heirs.contains(&&caller), "The lawyer cannot be the owner or an heir");
                will.lawyer = Some(caller.clone());
            }
        }
        emit("invite_claimed", serde_json::json!({ "owner": owner, "role": invite.role, "account": caller }));
        self.save(will);
        self.wills.flush();
        // Removing the invite frees more than the new entry takes; the freed bytes go back to the owner who paid.
        self.settle_storage(&owner, initial, NearToken::from_yoctonear(0));
    }

    /// Whether an invite is open (for the join page), by sha256(code).
    pub fn get_invite(&self, owner: AccountId, code_hash: String) -> Option<Invite> {
        read_invite(&owner, &code_hash)
    }
}
