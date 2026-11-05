use super::*;

#[near(serializers = [json])]
pub struct VaultPaths {
    pub eth: Option<String>,
    pub btc: Option<String>,
}

#[near]
impl Contract {
    pub fn get_will(&self, owner: AccountId) -> Option<Will> {
        self.wills.get(&owner).cloned()
    }

    pub fn get_state(&self, owner: AccountId) -> Option<WillState> {
        self.wills.get(&owner).map(|w| w.state.clone())
    }

    /// MPC derivation paths of the will's foreign vaults (derived under this contract's account).
    pub fn get_vault_paths(&self, owner: AccountId) -> Option<VaultPaths> {
        self.wills.get(&owner).map(|w| {
            let path = |c: Chain| w.foreign_chains.contains(&c).then(|| vault_path(&owner, c));
            VaultPaths {
                eth: path(Chain::Eth),
                btc: path(Chain::Btc),
            }
        })
    }

    /// Whether the will may escalate, and what it still needs if not (CLAUDE.md §5.5).
    pub fn is_armed(&self, owner: AccountId) -> ArmedStatus {
        let missing = self
            .wills
            .get(&owner)
            .map(|w| w.armed_missing())
            .unwrap_or_else(|| vec!["No will".to_string()]);
        ArmedStatus {
            armed: missing.is_empty(),
            missing,
        }
    }

    pub fn get_agent_pubkey(&self) -> Option<AgentKey> {
        self.agent_key.clone()
    }

    pub fn get_released_notes(&self, owner: AccountId, heir: AccountId) -> Vec<ReleasedNote> {
        self.wills
            .get(&owner)
            .map(|w| {
                w.released_notes
                    .iter()
                    .filter(|n| n.heir == heir)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Total NEAR held in all wills' vaults (part of this contract's balance).
    pub fn get_total_vault_near(&self) -> U128 {
        U128(self.total_vault_near)
    }
}
