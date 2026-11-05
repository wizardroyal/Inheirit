// Unit tests for the will state machine. Written from CLAUDE.md §5.3 (transition table) and
// §5.4 (required tests) before the implementation.
use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{NearToken, PromiseError, testing_env};
use shade_attestation::{
    attestation::create_mock_dstack_attestation, measurements::create_mock_full_measurements_hex,
};

const CONTRACT: &str = "heirloom.testnet";
const ADMIN: &str = "admin.testnet";
const MPC: &str = "v1.signer-prod.testnet";
const AGENT: &str = "agent.testnet";
const OWNER: &str = "alice.testnet";
const H1: &str = "bola.testnet";
const H2: &str = "charity.testnet";
const G1: &str = "g1.testnet";
const G2: &str = "g2.testnet";
const G3: &str = "g3.testnet";
const C1: &str = "friend.testnet";
const LAWYER: &str = "lawyer.testnet";
const STRANGER: &str = "mallory.testnet";

const T0: u64 = 1_800_000_000; // seconds
const ONE_NEAR: u128 = 10u128.pow(24);
const STORAGE_DEPOSIT: NearToken = NearToken::from_near(1);
const PAYLOAD: &str = "0101010101010101010101010101010101010101010101010101010101010101";
const POLICY_HASH: &str = "aa00000000000000000000000000000000000000000000000000000000000000";
const HEIR_KEY: &str = "bb00000000000000000000000000000000000000000000000000000000000000";
const EVIDENCE: &str = "cc00000000000000000000000000000000000000000000000000000000000000";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// Test harness: one contract, a mocked clock, and helpers to act as each party.
struct T {
    c: Contract,
    now: u64,
}

impl T {
    fn new() -> Self {
        // testing_env! carries storage over between calls; start every harness from empty storage.
        near_sdk::mock::with_mocked_blockchain(|b| {
            b.take_storage();
        });
        let mut t = T {
            c: {
                set_ctx(ADMIN, T0, NearToken::from_yoctonear(0));
                Contract::new(false, U64(10u64.pow(12)), acc(ADMIN), acc(MPC))
            },
            now: T0,
        };
        t.as_(ADMIN);
        t.c.approve_measurements(create_mock_full_measurements_hex());
        t.c.approve_ppids(vec![Ppid::default()]);
        t.c.whitelist_agent_for_local(acc(AGENT));
        t.pay(AGENT, NearToken::from_millinear(5));
        t.c.register_agent(create_mock_dstack_attestation());
        t
    }

    fn as_(&mut self, who: &str) -> &mut Contract {
        set_ctx(who, self.now, NearToken::from_yoctonear(0));
        &mut self.c
    }

    fn pay(&mut self, who: &str, deposit: NearToken) -> &mut Contract {
        set_ctx(who, self.now, deposit);
        &mut self.c
    }

    fn wait(&mut self, secs: u64) {
        self.now += secs;
    }

    fn state(&self) -> WillState {
        self.c.get_state(acc(OWNER)).unwrap()
    }

    fn will(&self) -> Will {
        self.c.wills.get(&acc(OWNER)).unwrap().clone()
    }

    /// Demo will: 2 heirs (80/20 NEAR), 3 guardians (2-of-3), 1 contact, stages 10/30/60,
    /// ETH + BTC vaults, demo timings, funded with 10 NEAR.
    fn with_will() -> Self {
        Self::with_config(config())
    }

    /// Creates the will, funds it with 10 NEAR and has every guardian accept (so it is armed).
    fn with_config(cfg: WillConfig) -> Self {
        let mut t = Self::unaccepted(cfg);
        for g in [G1, G2, G3] {
            t.as_(g).accept_guardian(acc(OWNER));
        }
        t
    }

    /// Creates and funds the will; no guardian has accepted yet, so it is not armed.
    fn unaccepted(cfg: WillConfig) -> Self {
        let mut t = T::new();
        t.pay(OWNER, STORAGE_DEPOSIT).create_will(cfg);
        t.pay(OWNER, NearToken::from_near(10)).deposit_near();
        t
    }

    fn advance(&mut self) -> bool {
        self.as_(STRANGER).advance(acc(OWNER))
    }

    fn to_quiet(&mut self) {
        self.wait(120);
        assert!(self.advance());
        assert!(matches!(self.state(), WillState::Quiet { .. }));
    }

    fn to_welfare(&mut self) {
        self.to_quiet();
        self.wait(60);
        assert!(self.advance());
        assert!(matches!(self.state(), WillState::WelfareCheck { .. }));
    }

    fn to_vote(&mut self) {
        self.to_welfare();
        self.wait(60);
        assert!(self.advance());
        assert!(matches!(self.state(), WillState::GuardianVote { .. }));
    }

    fn to_challenge(&mut self) {
        self.to_vote();
        self.as_(G1).attest(acc(OWNER), AttestKind::Deceased, None);
        self.as_(G2).attest(acc(OWNER), AttestKind::Deceased, None);
        assert!(matches!(self.state(), WillState::Challenge { .. }));
    }

    fn to_executing(&mut self) {
        self.to_challenge();
        self.wait(120);
        assert!(self.advance());
        assert!(matches!(
            self.state(),
            WillState::Executing { stage: 0, .. }
        ));
    }

    /// Runs every stage of the harness schedule (10/30/60, 60 s waits), marks every foreign
    /// (stage, chain) done and enters SecretsBuffer.
    fn to_secrets_buffer(&mut self) {
        self.to_executing();
        self.to_secrets_buffer_from_executing();
    }

    fn to_secrets_released(&mut self) {
        self.to_secrets_buffer();
        self.wait(60);
        assert!(self.advance());
        assert!(matches!(self.state(), WillState::SecretsReleased { .. }));
    }

    /// No sealed notes in the harness will, so SecretsReleased completes on the next advance.
    fn to_completed(&mut self) {
        self.to_secrets_released();
        assert!(self.advance());
        assert!(matches!(self.state(), WillState::Completed { .. }));
    }

    fn mark_all_done(&mut self, stages: u8) {
        for stage in 0..stages {
            for chain in [Chain::Eth, Chain::Btc] {
                self.as_(AGENT).mark_stage_done(acc(OWNER), stage, chain);
            }
        }
    }

    fn sign(&mut self, chain: Chain, purpose: SignPurpose) {
        self.as_(AGENT)
            .request_signature(acc(OWNER), chain, PAYLOAD.to_string(), purpose)
            .detach();
    }
}

fn set_ctx(who: &str, now: u64, deposit: NearToken) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(CONTRACT))
        .signer_account_id(acc(who))
        .predecessor_account_id(acc(who))
        .block_timestamp(now * 1_000_000_000)
        .account_balance(NearToken::from_near(1000))
        .attached_deposit(deposit);
    testing_env!(b.build());
}

fn demo_timings() -> Timings {
    Timings {
        quiet_after: 120,
        nudge_period: 60,
        welfare_period: 60,
        vote_period: 300,
        challenge_period: 120,
        secrets_buffer: 60,
    }
}

fn stages(pcts: &[u8], waits: &[u64]) -> Vec<Stage> {
    pcts.iter()
        .zip(waits)
        .map(|(&pct, &wait_after)| Stage { pct, wait_after })
        .collect()
}

fn config() -> WillConfig {
    WillConfig {
        heirs: vec![
            HeirInput {
                account_id: acc(H1),
                name: "Bola".into(),
                near_share_bps: 8000,
            },
            HeirInput {
                account_id: acc(H2),
                name: "Charity Fund".into(),
                near_share_bps: 2000,
            },
        ],
        guardians: vec![acc(G1), acc(G2), acc(G3)],
        guardian_threshold: 2,
        contacts: vec![acc(C1)],
        stages: stages(&[10, 30, 60], &[60, 60, 60]),
        accelerated_stages: stages(&[10, 30, 60], &[20, 20, 20]),
        timings: demo_timings(),
        policy_hash: POLICY_HASH.into(),
        foreign_chains: vec![Chain::Eth, Chain::Btc],
        lawyer: Some(acc(LAWYER)),
        heirs_hidden: true,
    }
}

/// The v2 standard schedule from CLAUDE.md §5.5: 10/20/30/40 with the longest wait first.
fn config_v2() -> WillConfig {
    let mut c = config();
    c.stages = stages(&[10, 20, 30, 40], &[180, 60, 60, 60]);
    c
}

fn near(n: u128) -> u128 {
    n * ONE_NEAR
}

// ---------------------------------------------------------------- create / update / validation

#[test]
fn create_will_starts_active_with_vault_paths() {
    let t = T::with_will();
    assert_eq!(t.state(), WillState::Active);
    let w = t.will();
    assert_eq!(w.last_alive_at, T0);
    assert_eq!(w.near_balance.0, near(10));
    assert_eq!(t.c.get_total_vault_near().0, near(10));
    let paths = t.c.get_vault_paths(acc(OWNER)).unwrap();
    assert_eq!(paths.eth.as_deref(), Some("heirloom/alice.testnet/eth"));
    assert_eq!(paths.btc.as_deref(), Some("heirloom/alice.testnet/btc"));
}

#[test]
fn create_will_refunds_excess_storage_deposit() {
    let mut t = T::new();
    t.pay(OWNER, STORAGE_DEPOSIT).create_will(config());
    let refunds = get_created_receipts()
        .into_iter()
        .filter(|r| r.receiver_id == acc(OWNER))
        .count();
    assert_eq!(
        refunds, 1,
        "excess storage deposit should be refunded to the owner"
    );
}

#[test]
#[should_panic(expected = "for storage")]
fn create_will_requires_storage_deposit() {
    let mut t = T::new();
    t.pay(OWNER, NearToken::from_yoctonear(1))
        .create_will(config());
}

#[test]
#[should_panic(expected = "Will already exists")]
fn create_will_twice_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT).create_will(config());
}

fn create_invalid(mutate: impl FnOnce(&mut WillConfig)) {
    let mut t = T::new();
    let mut cfg = config();
    mutate(&mut cfg);
    t.pay(OWNER, STORAGE_DEPOSIT).create_will(cfg);
}

#[test]
#[should_panic(expected = "Stages must sum to 100")]
fn stages_must_sum_to_100() {
    create_invalid(|c| c.stages = stages(&[10, 30, 50], &[60, 60, 60]));
}

#[test]
#[should_panic(expected = "NEAR shares must sum to 10000")]
fn near_shares_must_sum_to_10000() {
    create_invalid(|c| c.heirs[1].near_share_bps = 1000);
}

#[test]
#[should_panic(expected = "Invalid guardian threshold")]
fn threshold_above_guardian_count_rejected() {
    create_invalid(|c| c.guardian_threshold = 4);
}

#[test]
#[should_panic(expected = "Invalid guardian threshold")]
fn zero_threshold_rejected() {
    create_invalid(|c| c.guardian_threshold = 0);
}

#[test]
#[should_panic(expected = "A guardian cannot be an heir")]
fn guardian_cannot_be_heir() {
    create_invalid(|c| c.guardians[0] = acc(H1));
}

#[test]
#[should_panic(expected = "The owner cannot be a guardian")]
fn owner_cannot_be_guardian() {
    create_invalid(|c| c.guardians[0] = acc(OWNER));
}

#[test]
#[should_panic(expected = "Duplicate guardian")]
fn duplicate_guardian_rejected() {
    create_invalid(|c| c.guardians[1] = acc(G1));
}

#[test]
#[should_panic(expected = "policy_hash")]
fn bad_policy_hash_rejected() {
    create_invalid(|c| c.policy_hash = "xyz".into());
}

#[test]
#[should_panic(expected = "NEAR is not a foreign chain")]
fn near_is_not_a_foreign_chain() {
    create_invalid(|c| c.foreign_chains = vec![Chain::Near]);
}

#[test]
fn update_will_in_active() {
    let mut t = T::with_will();
    let mut cfg = config();
    cfg.guardian_threshold = 3;
    t.pay(OWNER, STORAGE_DEPOSIT).update_will(cfg);
    assert_eq!(t.will().guardian_threshold, 3);
}

#[test]
#[should_panic(expected = "Will can only be changed while Active")]
fn update_will_rejected_after_active() {
    let mut t = T::with_will();
    t.to_quiet();
    t.pay(OWNER, STORAGE_DEPOSIT).update_will(config());
}

#[test]
fn update_will_keeps_registered_heir_keys() {
    let mut t = T::with_will();
    t.as_(H1).register_heir_key(acc(OWNER), HEIR_KEY.into());
    t.pay(OWNER, STORAGE_DEPOSIT).update_will(config());
    assert_eq!(t.will().heirs[0].x25519_pubkey.as_deref(), Some(HEIR_KEY));
}

// ---------------------------------------------------------------- §5.3 transitions, row by row

#[test]
fn active_to_quiet_only_after_quiet_after() {
    let mut t = T::with_will();
    t.wait(119);
    assert!(!t.advance());
    assert_eq!(t.state(), WillState::Active);
    t.wait(1);
    assert!(t.advance());
    assert_eq!(t.state(), WillState::Quiet { since: T0 + 120 });
}

#[test]
fn quiet_to_welfare_after_nudge_period() {
    let mut t = T::with_will();
    t.to_quiet();
    t.wait(59);
    assert!(!t.advance());
    t.wait(1);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::WelfareCheck { .. }));
}

#[test]
fn welfare_to_vote_after_welfare_period() {
    let mut t = T::with_will();
    t.to_welfare();
    t.wait(59);
    assert!(!t.advance());
    t.wait(1);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::GuardianVote { .. }));
}

#[test]
fn vote_reaches_challenge_at_exactly_threshold() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(G1)
        .attest(acc(OWNER), AttestKind::Deceased, Some(POLICY_HASH.into()));
    assert!(
        matches!(t.state(), WillState::GuardianVote { .. }),
        "1 of 2 is not enough"
    );
    t.as_(G2).attest(acc(OWNER), AttestKind::Deceased, None);
    assert!(matches!(t.state(), WillState::Challenge { .. }));
}

#[test]
fn vote_alive_attestation_returns_to_active() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(G1).attest(acc(OWNER), AttestKind::Deceased, None);
    t.as_(G3).attest(acc(OWNER), AttestKind::Alive, None);
    assert_eq!(t.state(), WillState::Active);
    assert!(
        t.will().attestations.is_empty(),
        "attestations are cleared on reset"
    );
    assert_eq!(t.will().last_alive_at, t.now);
}

#[test]
fn vote_period_expiry_without_quorum_returns_to_active() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(G1).attest(acc(OWNER), AttestKind::Deceased, None);
    t.wait(299);
    assert!(!t.advance());
    t.wait(1);
    assert!(t.advance());
    assert_eq!(t.state(), WillState::Active);
    assert!(t.will().attestations.is_empty());
}

#[test]
fn challenge_to_executing_after_challenge_period_releases_stage_0() {
    let mut t = T::with_will();
    t.to_challenge();
    t.wait(119);
    assert!(!t.advance());
    t.wait(1);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::Executing { stage: 0, .. }));
    let w = t.will();
    assert_eq!(w.execution_round, 1);
    assert_eq!(w.near_snapshot.0, near(10));
    // stage 0 = 10% of 10 NEAR, split 80/20
    assert_eq!(w.near_balance.0, near(9));
    let near_recs: Vec<_> = w
        .executions
        .iter()
        .filter(|e| e.chain == Chain::Near)
        .collect();
    assert_eq!(near_recs.len(), 2);
    assert_eq!(near_recs[0].amount, (near(1) * 8 / 10).to_string());
    assert_eq!(near_recs[1].amount, (near(1) * 2 / 10).to_string());
}

#[test]
fn executing_advances_stage_after_interval() {
    let mut t = T::with_will();
    t.to_executing();
    t.wait(59);
    assert!(!t.advance());
    t.wait(1);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::Executing { stage: 1, .. }));
    assert_eq!(t.will().near_balance.0, near(6)); // 10% + 30% released
}

#[test]
fn last_stage_releases_everything_left_then_secrets_buffer_when_foreign_chains_done() {
    let mut t = T::with_will();
    t.to_executing();
    t.wait(60);
    t.advance();
    t.wait(60);
    t.advance();
    assert!(matches!(t.state(), WillState::Executing { stage: 2, .. }));
    assert_eq!(t.will().near_balance.0, 0);
    assert_eq!(t.c.get_total_vault_near().0, 0);

    t.wait(60);
    assert!(!t.advance(), "foreign chains not done yet");
    t.mark_all_done(3);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::SecretsBuffer { .. }));

    t.wait(59);
    assert!(!t.advance(), "buffer not over");
    t.wait(1);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::SecretsReleased { .. }));
    assert!(t.advance(), "no notes to release");
    assert!(matches!(t.state(), WillState::Completed { .. }));
    assert!(!t.advance(), "Completed is terminal");
}

// ---------------------------------------------------------------- cancel at every stage

fn states_before_completed() -> Vec<fn(&mut T)> {
    vec![
        T::to_quiet,
        T::to_welfare,
        T::to_vote,
        T::to_challenge,
        T::to_executing,
        T::to_secrets_buffer,
        T::to_secrets_released,
    ]
}

#[test]
fn i_am_alive_cancels_at_every_stage() {
    for reach in states_before_completed() {
        let mut t = T::with_will();
        reach(&mut t);
        t.wait(1);
        t.as_(OWNER).i_am_alive();
        assert_eq!(t.state(), WillState::Active);
        assert_eq!(t.will().last_alive_at, t.now);
        assert!(t.will().attestations.is_empty());
    }
}

#[test]
fn record_liveness_newer_than_state_cancels_at_every_stage() {
    for reach in states_before_completed() {
        let mut t = T::with_will();
        reach(&mut t);
        t.wait(5);
        let at = t.now - 1;
        assert!(t.as_(AGENT).record_liveness(acc(OWNER), at));
        assert_eq!(t.state(), WillState::Active);
        assert_eq!(t.will().last_alive_at, at);
    }
}

#[test]
fn record_liveness_older_than_state_updates_time_but_does_not_cancel() {
    let mut t = T::with_will();
    t.to_quiet(); // Quiet since T0+120
    t.wait(10);
    assert!(t.as_(AGENT).record_liveness(acc(OWNER), T0 + 100));
    assert!(matches!(t.state(), WillState::Quiet { .. }));
    assert_eq!(t.will().last_alive_at, T0 + 100);
    assert!(
        !t.as_(AGENT).record_liveness(acc(OWNER), T0 + 50),
        "older than last_alive_at is a no-op"
    );
}

#[test]
#[should_panic(expected = "in the future")]
fn record_liveness_future_rejected() {
    let mut t = T::with_will();
    let at = t.now + 10;
    t.as_(AGENT).record_liveness(acc(OWNER), at);
}

#[test]
#[should_panic(expected = "Agent not registered")]
fn record_liveness_by_non_agent_rejected() {
    let mut t = T::with_will();
    let at = t.now;
    t.as_(STRANGER).record_liveness(acc(OWNER), at);
}

#[test]
#[should_panic(expected = "Will already completed")]
fn i_am_alive_after_completed_rejected() {
    let mut t = T::with_will();
    t.to_completed();
    t.as_(OWNER).i_am_alive();
}

#[test]
fn contact_confirm_alive_in_quiet_and_welfare() {
    let mut t = T::with_will();
    t.to_quiet();
    t.as_(C1).contact_confirm_alive(acc(OWNER));
    assert_eq!(t.state(), WillState::Active);

    let mut t = T::with_will();
    t.to_welfare();
    t.as_(C1).contact_confirm_alive(acc(OWNER));
    assert_eq!(t.state(), WillState::Active);
    assert_eq!(t.will().last_alive_at, t.now);
}

#[test]
#[should_panic(expected = "only in Quiet or WelfareCheck")]
fn contact_confirm_alive_rejected_in_vote() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(C1).contact_confirm_alive(acc(OWNER));
}

#[test]
#[should_panic(expected = "Not a contact")]
fn non_contact_confirm_rejected() {
    let mut t = T::with_will();
    t.to_quiet();
    t.as_(STRANGER).contact_confirm_alive(acc(OWNER));
}

// ---------------------------------------------------------------- guardians

#[test]
#[should_panic(expected = "Not a guardian")]
fn non_guardian_attest_rejected() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(H1).attest(acc(OWNER), AttestKind::Deceased, None);
}

#[test]
#[should_panic(expected = "Already attested")]
fn double_attestation_rejected() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(G1).attest(acc(OWNER), AttestKind::Deceased, None);
    t.as_(G1).attest(acc(OWNER), AttestKind::Deceased, None);
}

#[test]
#[should_panic(expected = "only during GuardianVote")]
fn attest_outside_vote_rejected() {
    let mut t = T::with_will();
    t.to_welfare();
    t.as_(G1).attest(acc(OWNER), AttestKind::Deceased, None);
}

#[test]
#[should_panic(expected = "evidence_hash")]
fn bad_evidence_hash_rejected() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(G1)
        .attest(acc(OWNER), AttestKind::Deceased, Some("nothex".into()));
}

// ---------------------------------------------------------------- signature gating

fn release_sign_panics_in(reach: Option<fn(&mut T)>) -> bool {
    let mut t = T::with_will();
    if let Some(r) = reach {
        r(&mut t);
    }
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.sign(Chain::Eth, SignPurpose::Release { stage: 0 })
    }))
    .is_err()
}

#[test]
fn release_signature_rejected_in_every_non_executing_state() {
    assert!(release_sign_panics_in(None), "Active");
    for reach in [
        T::to_quiet,
        T::to_welfare,
        T::to_vote,
        T::to_challenge,
        T::to_secrets_buffer,
        T::to_secrets_released,
    ] {
        assert!(release_sign_panics_in(Some(reach)));
    }
    assert!(
        !release_sign_panics_in(Some(T::to_executing)),
        "allowed while Executing"
    );
}

#[test]
fn release_signature_uses_vault_path_and_counts() {
    let mut t = T::with_will();
    t.to_executing();
    t.sign(Chain::Btc, SignPurpose::Release { stage: 0 });
    let receipts = get_created_receipts();
    let sign = receipts
        .iter()
        .find(|r| r.receiver_id == acc(MPC))
        .expect("MPC sign call");
    let args = sign
        .actions
        .iter()
        .find_map(|a| match a {
            near_sdk::mock::MockAction::FunctionCallWeight {
                method_name, args, ..
            } if method_name == b"sign" => Some(String::from_utf8(args.clone()).unwrap()),
            _ => None,
        })
        .expect("sign function call");
    assert!(
        args.contains("\"path\":\"heirloom/alice.testnet/btc\""),
        "path must be the will's vault path: {args}"
    );
    assert!(args.contains("\"domain_id\":0"), "Ecdsa domain: {args}");
    assert_eq!(t.will().sign_counts.len(), 1);
}

#[test]
#[should_panic(expected = "Stage not reached")]
fn release_signature_for_future_stage_rejected() {
    let mut t = T::with_will();
    t.to_executing();
    t.sign(Chain::Eth, SignPurpose::Release { stage: 1 });
}

#[test]
#[should_panic(expected = "already done")]
fn release_signature_after_stage_done_rejected() {
    let mut t = T::with_will();
    t.to_executing();
    t.as_(AGENT).mark_stage_done(acc(OWNER), 0, Chain::Eth);
    t.sign(Chain::Eth, SignPurpose::Release { stage: 0 });
}

#[test]
#[should_panic(expected = "Chain has no vault")]
fn release_signature_for_chain_without_vault_rejected() {
    let mut cfg = config();
    cfg.foreign_chains = vec![Chain::Eth];
    let mut t = T::with_config(cfg);
    t.to_executing();
    t.sign(Chain::Btc, SignPurpose::Release { stage: 0 });
}

#[test]
#[should_panic(expected = "Signature limit")]
fn release_signature_count_is_capped() {
    let mut t = T::with_will();
    t.to_executing();
    for _ in 0..=MAX_SIGNATURES_PER_STAGE_CHAIN {
        t.sign(Chain::Btc, SignPurpose::Release { stage: 0 });
    }
}

#[test]
#[should_panic(expected = "Payload must be 32 bytes hex")]
fn bad_payload_rejected() {
    let mut t = T::with_will();
    t.to_executing();
    t.as_(AGENT)
        .request_signature(
            acc(OWNER),
            Chain::Eth,
            "abcd".into(),
            SignPurpose::Release { stage: 0 },
        )
        .detach();
}

#[test]
#[should_panic(expected = "Agent not registered")]
fn signature_by_non_agent_rejected() {
    let mut t = T::with_will();
    t.to_executing();
    t.as_(OWNER)
        .request_signature(
            acc(OWNER),
            Chain::Eth,
            PAYLOAD.into(),
            SignPurpose::Release { stage: 0 },
        )
        .detach();
}

#[test]
fn withdrawal_signature_matches_pending_withdrawal() {
    let mut t = T::with_will();
    t.as_(OWNER)
        .request_withdrawal(Chain::Eth, "0xabc".into(), U128(1000));
    t.sign(Chain::Eth, SignPurpose::Withdrawal { id: 0 });
    assert_eq!(t.will().pending_withdrawals[0].signatures, 1);
    t.as_(AGENT)
        .complete_withdrawal(acc(OWNER), 0, "0xtx".into());
    assert!(t.will().pending_withdrawals.is_empty());
}

#[test]
#[should_panic(expected = "No such pending withdrawal")]
fn withdrawal_signature_without_request_rejected() {
    let mut t = T::with_will();
    t.sign(Chain::Eth, SignPurpose::Withdrawal { id: 0 });
}

#[test]
#[should_panic(expected = "Withdrawal is for another chain")]
fn withdrawal_signature_wrong_chain_rejected() {
    let mut t = T::with_will();
    t.as_(OWNER)
        .request_withdrawal(Chain::Eth, "0xabc".into(), U128(1000));
    t.sign(Chain::Btc, SignPurpose::Withdrawal { id: 0 });
}

#[test]
#[should_panic(expected = "only while Active")]
fn withdrawal_signature_rejected_once_escalating() {
    let mut t = T::with_will();
    t.as_(OWNER)
        .request_withdrawal(Chain::Eth, "0xabc".into(), U128(1000));
    t.to_quiet();
    t.sign(Chain::Eth, SignPurpose::Withdrawal { id: 0 });
}

// ---------------------------------------------------------------- withdrawals and NEAR vault

#[test]
#[should_panic(expected = "only while Active")]
fn withdrawal_request_only_in_active() {
    let mut t = T::with_will();
    t.to_quiet();
    t.as_(OWNER)
        .request_withdrawal(Chain::Eth, "0xabc".into(), U128(1));
}

#[test]
#[should_panic(expected = "No will")]
fn withdrawal_request_by_non_owner_has_no_will() {
    let mut t = T::with_will();
    t.as_(STRANGER)
        .request_withdrawal(Chain::Near, STRANGER.into(), U128(1));
}

#[test]
fn near_withdrawal_debits_vault_immediately() {
    let mut t = T::with_will();
    t.as_(OWNER)
        .request_withdrawal(Chain::Near, OWNER.into(), U128(near(3)));
    assert_eq!(t.will().near_balance.0, near(7));
    assert_eq!(t.c.get_total_vault_near().0, near(7));
    assert!(
        t.will().pending_withdrawals.is_empty(),
        "NEAR withdrawals are not queued"
    );
}

#[test]
#[should_panic(expected = "Insufficient NEAR in vault")]
fn near_withdrawal_over_balance_rejected() {
    let mut t = T::with_will();
    t.as_(OWNER)
        .request_withdrawal(Chain::Near, OWNER.into(), U128(near(11)));
}

#[test]
fn failed_near_transfer_is_recredited() {
    let mut t = T::with_will();
    t.as_(OWNER)
        .request_withdrawal(Chain::Near, "missing.testnet".into(), U128(near(3)));
    t.as_(CONTRACT)
        .on_near_transfer(acc(OWNER), U128(near(3)), Err(PromiseError::Failed));
    assert_eq!(t.will().near_balance.0, near(10));
    assert_eq!(t.c.get_total_vault_near().0, near(10));
}

#[test]
#[should_panic(expected = "deposits are closed")]
fn deposit_rejected_while_executing() {
    let mut t = T::with_will();
    t.to_executing();
    t.pay(OWNER, NearToken::from_near(1)).deposit_near();
}

// ---------------------------------------------------------------- partial execution

#[test]
fn owner_returning_mid_execution_halts_remaining_stages() {
    let mut t = T::with_will();
    t.to_executing();
    t.wait(10);
    t.as_(OWNER).i_am_alive();
    assert_eq!(t.state(), WillState::Active);
    let w = t.will();
    assert_eq!(w.near_balance.0, near(9), "only stage 0 was released");
    assert_eq!(w.halted.len(), 1);
    assert_eq!(w.halted[0].round, 1);
    assert_eq!(w.halted[0].stage, 0);
    // later stages never run
    t.wait(1000);
    t.advance(); // Active -> Quiet (owner silent again), but no release
    assert_eq!(t.will().near_balance.0, near(9));
}

#[test]
fn re_execution_after_halt_starts_new_round_from_new_snapshot() {
    let mut t = T::with_will();
    t.to_executing();
    t.as_(OWNER).i_am_alive();
    t.to_executing();
    let w = t.will();
    assert_eq!(w.execution_round, 2);
    assert_eq!(w.near_snapshot.0, near(9));
    assert!(w.stage_done.is_empty() && w.sign_counts.is_empty());
}

// ---------------------------------------------------------------- sealed notes and keys

#[test]
fn sealed_note_release_flow() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(H1), "Ledger".into(), vec![7u8; 100].into());
    assert_eq!(t.will().sealed_notes.len(), 1);
    t.as_(H1).register_heir_key(acc(OWNER), HEIR_KEY.into());
    t.to_secrets_released();
    assert!(!t.advance(), "a note is still unreleased");
    t.as_(AGENT)
        .store_released_note(acc(OWNER), 0, acc(H1), vec![9u8; 148].into());
    let released = t.c.get_released_notes(acc(OWNER), acc(H1));
    assert_eq!(released.len(), 1);
    assert_eq!(released[0].note_id, 0);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::Completed { .. }));
}

#[test]
#[should_panic(expected = "Notes are released only in SecretsReleased")]
fn note_release_before_execution_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(H1), "Ledger".into(), vec![7u8; 100].into());
    t.as_(H1).register_heir_key(acc(OWNER), HEIR_KEY.into());
    t.to_challenge();
    t.as_(AGENT)
        .store_released_note(acc(OWNER), 0, acc(H1), vec![9u8; 148].into());
}

#[test]
#[should_panic(expected = "Heir has not registered a key")]
fn note_release_without_heir_key_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(H1), "Ledger".into(), vec![7u8; 100].into());
    t.to_secrets_released();
    t.as_(AGENT)
        .store_released_note(acc(OWNER), 0, acc(H1), vec![9u8; 148].into());
}

#[test]
#[should_panic(expected = "Note is for another heir")]
fn note_release_to_wrong_heir_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(H1), "Ledger".into(), vec![7u8; 100].into());
    t.as_(H2).register_heir_key(acc(OWNER), HEIR_KEY.into());
    t.to_secrets_released();
    t.as_(AGENT)
        .store_released_note(acc(OWNER), 0, acc(H2), vec![9u8; 148].into());
}

#[test]
#[should_panic(expected = "Ciphertext too large")]
fn oversized_note_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT).add_sealed_note(
        acc(H1),
        "Big".into(),
        vec![0u8; MAX_NOTE_CIPHERTEXT_BYTES + 1].into(),
    );
}

#[test]
#[should_panic(expected = "Not an heir")]
fn note_for_non_heir_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(STRANGER), "x".into(), vec![1u8; 10].into());
}

#[test]
fn remove_sealed_note_refunds_storage() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(H1), "Ledger".into(), vec![7u8; 1000].into());
    t.as_(OWNER).remove_sealed_note(0);
    assert!(t.will().sealed_notes.is_empty());
    assert!(
        get_created_receipts()
            .iter()
            .any(|r| r.receiver_id == acc(OWNER))
    );
}

#[test]
#[should_panic(expected = "Not an heir")]
fn register_heir_key_by_non_heir_rejected() {
    let mut t = T::with_will();
    t.as_(STRANGER)
        .register_heir_key(acc(OWNER), HEIR_KEY.into());
}

#[test]
#[should_panic(expected = "x25519_pubkey")]
fn register_heir_key_must_be_32_bytes_hex() {
    let mut t = T::with_will();
    t.as_(H1).register_heir_key(acc(OWNER), "abc".into());
}

#[test]
fn agent_pubkey_set_once_then_only_admin_rotates() {
    let mut t = T::new();
    t.as_(AGENT)
        .set_agent_pubkey(HEIR_KEY.into(), "bb06".into());
    assert_eq!(t.c.get_agent_pubkey().unwrap().x25519_pubkey, HEIR_KEY);
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.as_(AGENT)
            .set_agent_pubkey(POLICY_HASH.into(), "other".into())
    }));
    assert!(again.is_err(), "agent cannot overwrite the key");
    t.as_(ADMIN)
        .rotate_agent_pubkey(POLICY_HASH.into(), "new-app".into());
    assert_eq!(t.c.get_agent_pubkey().unwrap().app_id, "new-app");
}

// ---------------------------------------------------------------- v2: guardian consent, armed wills

#[test]
fn unarmed_will_never_escalates() {
    let mut t = T::unaccepted(config());
    let status = t.c.is_armed(acc(OWNER));
    assert!(!status.armed);
    assert!(!status.missing.is_empty());
    t.wait(100_000);
    assert!(!t.advance());
    assert_eq!(t.state(), WillState::Active);

    t.as_(G1).accept_guardian(acc(OWNER));
    assert!(!t.c.is_armed(acc(OWNER)).armed, "1 accepted < threshold 2");
    assert!(!t.advance());

    t.as_(G2).accept_guardian(acc(OWNER));
    let status = t.c.is_armed(acc(OWNER));
    assert!(status.armed && status.missing.is_empty());
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::Quiet { .. }));
}

#[test]
#[should_panic(expected = "Guardian has not accepted")]
fn unaccepted_guardian_cannot_attest() {
    let mut t = T::unaccepted(config());
    t.as_(G1).accept_guardian(acc(OWNER));
    t.as_(G2).accept_guardian(acc(OWNER));
    t.to_vote();
    t.as_(G3).attest(acc(OWNER), AttestKind::Deceased, None);
}

#[test]
#[should_panic(expected = "Not a guardian")]
fn accept_by_non_guardian_rejected() {
    let mut t = T::unaccepted(config());
    t.as_(STRANGER).accept_guardian(acc(OWNER));
}

#[test]
#[should_panic(expected = "Already accepted")]
fn double_accept_rejected() {
    let mut t = T::with_will();
    t.as_(G1).accept_guardian(acc(OWNER));
}

#[test]
fn invite_guardian_adds_an_unaccepted_guardian() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .invite_guardian(acc("g4.testnet"));
    let w = t.will();
    let g4 = w
        .guardians
        .iter()
        .find(|g| g.account_id == acc("g4.testnet"))
        .unwrap();
    assert!(!g4.accepted);
    assert_eq!(w.guardians.iter().filter(|g| g.accepted).count(), 3);
}

#[test]
#[should_panic(expected = "A guardian cannot be an heir")]
fn invite_heir_as_guardian_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT).invite_guardian(acc(H1));
}

#[test]
#[should_panic(expected = "Duplicate guardian")]
fn invite_existing_guardian_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT).invite_guardian(acc(G1));
}

#[test]
#[should_panic(expected = "only while Active")]
fn invite_guardian_rejected_while_escalating() {
    let mut t = T::with_will();
    t.to_quiet();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .invite_guardian(acc("g4.testnet"));
}

#[test]
fn update_will_keeps_acceptance_of_retained_guardians() {
    let mut t = T::with_will();
    let mut cfg = config();
    cfg.guardians = vec![acc(G1), acc("g4.testnet")];
    cfg.guardian_threshold = 1;
    t.pay(OWNER, STORAGE_DEPOSIT).update_will(cfg);
    let w = t.will();
    assert_eq!(w.guardians.len(), 2);
    assert!(w.guardians[0].accepted, "G1 keeps its acceptance");
    assert!(!w.guardians[1].accepted, "g4 is a new invite");
}

#[test]
fn lawyer_may_be_a_guardian() {
    let mut cfg = config();
    cfg.lawyer = Some(acc(G1));
    let t = T::with_config(cfg);
    assert_eq!(t.will().lawyer, Some(acc(G1)));
}

#[test]
#[should_panic(expected = "The lawyer cannot be an heir")]
fn lawyer_cannot_be_heir() {
    create_invalid(|c| c.lawyer = Some(acc(H1)));
}

#[test]
#[should_panic(expected = "The owner cannot be the lawyer")]
fn owner_cannot_be_lawyer() {
    create_invalid(|c| c.lawyer = Some(acc(OWNER)));
}

#[test]
fn guardian_and_lawyer_can_confirm_alive_during_welfare_check() {
    for who in [G3, LAWYER] {
        let mut t = T::with_will();
        t.to_welfare();
        t.as_(who).contact_confirm_alive(acc(OWNER));
        assert_eq!(t.state(), WillState::Active);
    }
}

// ---------------------------------------------------------------- v2: schedules and validation

#[test]
#[should_panic(expected = "Accelerated stages must sum to 100")]
fn accelerated_stages_must_sum_to_100() {
    create_invalid(|c| c.accelerated_stages = stages(&[10, 30], &[20, 20]));
}

#[test]
#[should_panic(expected = "Every stage wait must be > 0")]
fn zero_stage_wait_rejected() {
    create_invalid(|c| c.stages = stages(&[50, 50], &[60, 0]));
}

#[test]
#[should_panic(expected = "All timings must be > 0")]
fn zero_secrets_buffer_rejected() {
    create_invalid(|c| c.timings.secrets_buffer = 0);
}

#[test]
fn standard_schedule_waits_longest_after_the_first_slice() {
    let mut t = T::with_config(config_v2());
    t.to_executing();
    assert_eq!(t.will().near_balance.0, near(9), "10% first");
    t.wait(179);
    assert!(!t.advance(), "the longest wait comes after the first slice");
    t.wait(1);
    assert!(t.advance());
    assert_eq!(t.will().near_balance.0, near(7), "then 20%");
    t.wait(60);
    assert!(t.advance());
    assert_eq!(t.will().near_balance.0, near(4), "then 30%");
    t.wait(60);
    assert!(t.advance());
    assert_eq!(t.will().near_balance.0, 0, "then the rest (40%)");
    t.mark_all_done(4);
    t.wait(59);
    assert!(!t.advance());
    t.wait(1);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::SecretsBuffer { .. }));
}

// ---------------------------------------------------------------- v2: acceleration

#[test]
fn lawyer_death_proof_in_vote_accelerates_but_still_needs_quorum_and_challenge() {
    let mut t = T::with_config(config_v2());
    t.to_vote();
    t.as_(LAWYER)
        .attest_death_proof(acc(OWNER), EVIDENCE.into());
    assert!(t.will().accelerated);
    assert!(
        matches!(t.state(), WillState::GuardianVote { .. }),
        "no quorum skip"
    );

    t.as_(G1).attest(acc(OWNER), AttestKind::Deceased, None);
    t.as_(G2).attest(acc(OWNER), AttestKind::Deceased, None);
    assert!(matches!(t.state(), WillState::Challenge { .. }));
    t.wait(119);
    assert!(!t.advance(), "challenge period is never skipped");
    t.wait(1);
    assert!(t.advance());
    let w = t.will();
    assert_eq!(
        w.round_stages, w.accelerated_stages,
        "whole schedule switched before execution"
    );
    t.wait(20);
    assert!(t.advance());
    assert!(matches!(t.state(), WillState::Executing { stage: 1, .. }));
    assert_eq!(
        t.will().near_balance.0,
        near(6),
        "10% + 30% (accelerated slices)"
    );
}

#[test]
fn death_proof_during_execution_keeps_percentages_and_shortens_waits() {
    let mut t = T::with_config(config_v2());
    t.to_executing();
    t.wait(10);
    t.as_(LAWYER)
        .attest_death_proof(acc(OWNER), EVIDENCE.into());
    let w = t.will();
    let pcts: Vec<u8> = w.round_stages.iter().map(|s| s.pct).collect();
    assert_eq!(pcts, vec![10, 20, 30, 40], "percentages unchanged");
    let waits: Vec<u64> = w.round_stages.iter().map(|s| s.wait_after).collect();
    assert_eq!(
        waits,
        vec![20, 20, 20, 20],
        "capped at the accelerated waits"
    );
    t.wait(10);
    assert!(t.advance(), "stage 0 now ends 20 s after it started");
    assert!(matches!(t.state(), WillState::Executing { stage: 1, .. }));
    assert_eq!(t.will().near_balance.0, near(7));
}

#[test]
fn guardian_quorum_with_evidence_accelerates() {
    let mut t = T::with_will();
    t.to_challenge();
    t.as_(G1).attest_death_proof(acc(OWNER), EVIDENCE.into());
    assert!(!t.will().accelerated, "one guardian is not a quorum");
    t.as_(G2).attest_death_proof(acc(OWNER), EVIDENCE.into());
    assert!(t.will().accelerated);
    assert!(matches!(t.state(), WillState::Challenge { .. }));
}

#[test]
#[should_panic(expected = "Already submitted a death proof")]
fn double_death_proof_rejected() {
    let mut t = T::with_will();
    t.to_challenge();
    t.as_(G1).attest_death_proof(acc(OWNER), EVIDENCE.into());
    t.as_(G1).attest_death_proof(acc(OWNER), EVIDENCE.into());
}

#[test]
fn death_proof_rejected_from_other_callers_and_early_states() {
    let panics = |reach: fn(&mut T), who: &'static str| {
        let mut t = T::with_will();
        reach(&mut t);
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            t.as_(who).attest_death_proof(acc(OWNER), EVIDENCE.into())
        }))
        .is_err()
    };
    for who in [STRANGER, H1, C1, OWNER] {
        assert!(
            panics(T::to_vote, who),
            "{} may not attest a death proof",
            who
        );
    }
    for reach in [T::to_quiet, T::to_welfare] {
        assert!(panics(reach, LAWYER), "too early");
    }
    assert!(panics(T::to_secrets_buffer, LAWYER), "too late");
    assert!(!panics(T::to_executing, LAWYER));
}

#[test]
#[should_panic(expected = "Guardian has not accepted")]
fn unaccepted_guardian_death_proof_rejected() {
    let mut t = T::unaccepted(config());
    t.as_(G1).accept_guardian(acc(OWNER));
    t.as_(G2).accept_guardian(acc(OWNER));
    t.to_challenge();
    t.as_(G3).attest_death_proof(acc(OWNER), EVIDENCE.into());
}

#[test]
#[should_panic(expected = "evidence_hash")]
fn death_proof_needs_hex_evidence() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(LAWYER)
        .attest_death_proof(acc(OWNER), "nothex".into());
}

#[test]
fn acceleration_cleared_on_return_to_active() {
    let mut t = T::with_will();
    t.to_vote();
    t.as_(LAWYER)
        .attest_death_proof(acc(OWNER), EVIDENCE.into());
    t.as_(OWNER).i_am_alive();
    let w = t.will();
    assert!(!w.accelerated);
    assert!(w.death_proofs.is_empty());
}

// ---------------------------------------------------------------- v2: secrets last

#[test]
#[should_panic(expected = "Notes are released only in SecretsReleased")]
fn note_release_during_execution_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(H1), "Ledger".into(), vec![7u8; 100].into());
    t.as_(H1).register_heir_key(acc(OWNER), HEIR_KEY.into());
    t.to_executing();
    t.as_(AGENT)
        .store_released_note(acc(OWNER), 0, acc(H1), vec![9u8; 148].into());
}

#[test]
#[should_panic(expected = "Notes are released only in SecretsReleased")]
fn note_release_during_secrets_buffer_rejected() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(H1), "Ledger".into(), vec![7u8; 100].into());
    t.as_(H1).register_heir_key(acc(OWNER), HEIR_KEY.into());
    t.to_secrets_buffer();
    t.as_(AGENT)
        .store_released_note(acc(OWNER), 0, acc(H1), vec![9u8; 148].into());
}

#[test]
fn sign_of_life_during_secrets_buffer_halts_secrets() {
    let mut t = T::with_will();
    t.pay(OWNER, STORAGE_DEPOSIT)
        .add_sealed_note(acc(H1), "Ledger".into(), vec![7u8; 100].into());
    t.to_secrets_buffer();
    t.wait(10);
    t.as_(OWNER).i_am_alive();
    let w = t.will();
    assert_eq!(w.state, WillState::Active);
    assert_eq!(w.halted.len(), 1);
    assert_eq!(w.halted[0].stage, 2, "halted after the last slice");
    assert!(w.released_notes.is_empty());
    assert_eq!(w.near_balance.0, 0, "distribution already sent stays sent");
    assert_eq!(
        w.executions
            .iter()
            .filter(|e| e.chain == Chain::Near)
            .count(),
        6,
        "3 stages x 2 heirs recorded"
    );
}

#[test]
fn liveness_seen_during_execution_but_recorded_in_buffer_still_halts() {
    let mut t = T::with_will();
    t.to_executing();
    let during_execution = t.now + 5;
    t.to_secrets_buffer_from_executing();
    t.wait(1);
    assert!(t.as_(AGENT).record_liveness(acc(OWNER), during_execution));
    assert_eq!(t.state(), WillState::Active);
}

impl T {
    fn to_secrets_buffer_from_executing(&mut self) {
        for _ in 0..2 {
            self.wait(60);
            assert!(self.advance());
        }
        self.mark_all_done(3);
        self.wait(60);
        assert!(self.advance());
        assert!(matches!(self.state(), WillState::SecretsBuffer { .. }));
    }
}
