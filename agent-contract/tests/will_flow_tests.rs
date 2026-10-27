//! End-to-end will flow on a local sandbox: real blocks, real NEAR transfers, and the gated
//! request_signature calling a mock MPC contract. Replaces the template's cross_contract_tests,
//! which called the old ungated request_signature with an arbitrary path.
mod helpers;

use helpers::*;
use near_api::{AccountId, NearToken, NetworkConfig, Signer, Tokens};
use serde_json::{Value, json};
use shade_attestation::attestation::create_mock_dstack_attestation;
use std::sync::Arc;
use tokio::time::{Duration, sleep};

type R<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

const PAYLOAD: &str = "0101010101010101010101010101010101010101010101010101010101010101";
const POLICY_HASH: &str = "aa00000000000000000000000000000000000000000000000000000000000000";

struct Actor {
    id: AccountId,
    signer: Arc<Signer>,
}

struct World {
    net: NetworkConfig,
    contract: AccountId,
    agent: Actor,
    owner: Actor,
    heir1: Actor,
    heir2: Actor,
    g1: Actor,
    g2: Actor,
    _sandbox: near_sandbox::Sandbox,
}

impl World {
    async fn call(&self, who: &Actor, method: &str, args: Value, deposit: Option<NearToken>) -> R<near_api_types::transaction::result::ExecutionFinalResult> {
        call_transaction(&self.contract, method, args, &who.id, &who.signer, &self.net, deposit).await
    }

    async fn state(&self) -> R<Value> {
        Ok(call_view::<Value>(&self.contract, "get_state", json!({ "owner": self.owner.id }), &self.net).await?.data)
    }

    async fn will(&self) -> R<Value> {
        Ok(call_view::<Value>(&self.contract, "get_will", json!({ "owner": self.owner.id }), &self.net).await?.data)
    }

    async fn advance(&self) -> R<()> {
        sleep(Duration::from_millis(1100)).await; // every demo timing is 1 s
        self.call(&self.agent, "advance", json!({ "owner": self.owner.id }), None).await?.assert_success();
        Ok(())
    }

    async fn sign(&self, stage: u8) -> R<Result<(), String>> {
        let args = json!({
            "owner": self.owner.id,
            "chain": "Eth",
            "payload": PAYLOAD,
            "purpose": { "Release": { "stage": stage } }
        });
        Ok(self.call(&self.agent, "request_signature", args, None).await?.into_result().map(|_| ()).map_err(|e| format!("{e:?}")))
    }
}

async fn balance(net: &NetworkConfig, id: &AccountId) -> R<u128> {
    Ok(Tokens::account(id.clone()).near_balance().fetch_from(net).await?.total.as_yoctonear())
}

fn state_name(state: &Value) -> String {
    match state {
        Value::String(s) => s.clone(),
        Value::Object(o) => o.keys().next().cloned().unwrap_or_default(),
        _ => String::new(),
    }
}

async fn setup() -> R<World> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = create_network_config(&sandbox);
    let (genesis, genesis_signer) = setup_genesis_account().await;
    let mpc = deploy_mock_mpc_contract(&net, &genesis, &genesis_signer, "mpc").await?;
    let contract = deploy_contract(
        &net,
        &genesis,
        &genesis_signer,
        CONTRACT_WASM_PATH,
        Some("new"),
        Some(json!({
            "owner_id": genesis,
            "mpc_contract_id": mpc,
            "requires_tee": false,
            "attestation_expiration_time_ms": "100000000"
        })),
        None,
    )
    .await?;
    for (method, args) in [
        ("approve_measurements", approve_measurements_default_args()),
        ("approve_ppids", default_ppids_json()),
    ] {
        call_transaction(&contract, method, args, &genesis, &genesis_signer, &net, None).await?.assert_success();
    }
    let mut actors = vec![];
    for name in ["agent", "alice", "bola", "charity", "g1", "g2"] {
        let (id, signer) = create_user_account(&net, &genesis, &genesis_signer, name).await?;
        actors.push(Actor { id, signer });
    }
    let mut it = actors.into_iter();
    let w = World {
        agent: it.next().unwrap(),
        owner: it.next().unwrap(),
        heir1: it.next().unwrap(),
        heir2: it.next().unwrap(),
        g1: it.next().unwrap(),
        g2: it.next().unwrap(),
        net,
        contract,
        _sandbox: sandbox,
    };
    call_transaction(&w.contract, "whitelist_agent_for_local", json!({ "account_id": w.agent.id }), &genesis, &genesis_signer, &w.net, None)
        .await?
        .assert_success();
    w.call(&w.agent, "register_agent", json!({ "attestation": serde_json::to_value(create_mock_dstack_attestation())? }), Some(DEPOSIT_005_NEAR))
        .await?
        .assert_success();

    let one = 1u64;
    w.call(
        &w.owner,
        "create_will",
        json!({ "config": {
            "heirs": [
                { "account_id": w.heir1.id, "name": "Bola", "near_share_bps": 8000 },
                { "account_id": w.heir2.id, "name": "Charity", "near_share_bps": 2000 }
            ],
            "guardians": [w.g1.id, w.g2.id],
            "guardian_threshold": 2,
            "contacts": [],
            "stages_pct": [50, 50],
            "timings": { "quiet_after": one, "nudge_period": one, "welfare_period": one,
                         "vote_period": 600, "challenge_period": one, "stage_interval": 600 },
            "policy_hash": POLICY_HASH,
            "foreign_chains": ["Eth"]
        }}),
        Some(NearToken::from_near(1)),
    )
    .await?
    .assert_success();
    w.call(&w.owner, "deposit_near", json!({}), Some(NearToken::from_near(2))).await?.assert_success();
    Ok(w)
}

/// Silence -> guardians attest -> challenge -> stage 0 executes (NEAR lands, gated signature
/// reaches the MPC) -> owner returns mid-execution -> remaining stage halts.
#[tokio::test]
async fn will_executes_then_owner_return_halts_it() -> R<()> {
    let w = setup().await?;
    assert_eq!(state_name(&w.state().await?), "Active");

    // Not executing yet: release signatures are refused.
    let refused = w.sign(0).await?;
    assert!(refused.unwrap_err().contains("Release signatures only while Executing"));

    for expected in ["Quiet", "WelfareCheck", "GuardianVote"] {
        w.advance().await?;
        assert_eq!(state_name(&w.state().await?), expected);
    }
    for g in [&w.g1, &w.g2] {
        w.call(g, "attest", json!({ "owner": w.owner.id, "kind": "Deceased" }), None).await?.assert_success();
    }
    assert_eq!(state_name(&w.state().await?), "Challenge");

    let heir1_before = balance(&w.net, &w.heir1.id).await?;
    let heir2_before = balance(&w.net, &w.heir2.id).await?;
    w.advance().await?;
    assert_eq!(state_name(&w.state().await?), "Executing");
    sleep(Duration::from_millis(1500)).await; // transfer receipts settle
    let one_near = NearToken::from_near(1).as_yoctonear();
    assert_eq!(balance(&w.net, &w.heir1.id).await? - heir1_before, one_near * 8 / 10, "stage 0 = 50% of 2 NEAR, 80% to Bola");
    assert_eq!(balance(&w.net, &w.heir2.id).await? - heir2_before, one_near * 2 / 10);
    assert_eq!(w.will().await?["near_balance"], json!(one_near.to_string()));

    // Gated signature for the current stage goes through to the (mock) MPC contract.
    w.sign(0).await?.expect("stage 0 release signature");
    assert!(w.sign(1).await?.unwrap_err().contains("Stage not reached"));

    // The owner comes back: everything stops, and stage 1 never runs.
    w.call(&w.owner, "i_am_alive", json!({}), None).await?.assert_success();
    assert_eq!(state_name(&w.state().await?), "Active");
    let will = w.will().await?;
    assert_eq!(will["halted"][0]["stage"], json!(0));
    assert_eq!(will["near_balance"], json!(one_near.to_string()), "half the vault stays with the owner");
    assert!(w.sign(0).await?.unwrap_err().contains("Release signatures only while Executing"));
    Ok(())
}

/// Scenario A from CLAUDE.md §9: silence escalates to Challenge, then a sign of life cancels it
/// and no funds move.
#[tokio::test]
async fn sign_of_life_during_challenge_cancels_without_moving_funds() -> R<()> {
    let w = setup().await?;
    for _ in 0..3 {
        w.advance().await?;
    }
    for g in [&w.g1, &w.g2] {
        w.call(g, "attest", json!({ "owner": w.owner.id, "kind": "Deceased" }), None).await?.assert_success();
    }
    assert_eq!(state_name(&w.state().await?), "Challenge");

    // The agent saw a fresh signal (e.g. a signed NEAR tx) after the challenge began.
    sleep(Duration::from_millis(1100)).await;
    let latest = w.will().await?["state"]["Challenge"]["since"].as_u64().unwrap() + 1;
    w.call(&w.agent, "record_liveness", json!({ "owner": w.owner.id, "at": latest }), None).await?.assert_success();
    assert_eq!(state_name(&w.state().await?), "Active");
    assert_eq!(w.will().await?["near_balance"], json!(NearToken::from_near(2).as_yoctonear().to_string()));
    assert_eq!(w.will().await?["execution_round"], json!(0));
    Ok(())
}
