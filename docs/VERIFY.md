# Verify it yourself

Run all of it at once: `npx tsx scripts/verify.ts` (prints PASS/FAIL per check and also asks the running agent which key it derived). Everything below is a read-only call to NEAR testnet; nothing needs an account or a wallet. It checks the claims behind "the agent runs in a TEE and only approved code can move money".

```bash
view() {  # view <method> [json args]
  curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"inheirit.testnet\",\"method_name\":\"$1\",\"args_base64\":\"$(printf '%s' "${2:-{\}}" | base64 -w0)\"}}" \
  | python3 -c "import sys,json; print(json.dumps(json.loads(bytes(json.load(sys.stdin)['result']['result'])), indent=1))"
}
```

1. **The contract only accepts attested agents.**
   `view get_contract_info` → `"requires_tee": true`. With this flag, `register_agent` verifies a TDX attestation and can't be bypassed by the local-mode whitelist, which panics when `requires_tee` is set (`agent-contract/src/owner.rs`).

2. **Exactly one version of the agent is approved.**
   `view get_approved_measurements` lists the approved TDX measurements, including `app_compose_hash_payload`. Compare it with the latest entry in [`deploy/tee-agent.json`](../deploy/tee-agent.json), which also names the Docker image digest that compose file runs (`unwizarding/inheirit-agent@sha256:…`, the `image:` line of [`docker-compose.yaml`](../docker-compose.yaml)). Older hashes are retired after each upgrade.

3. **The running agent is registered under that version.**
   `view get_agents '{}'` lists registered agents with their measurements and `"validity": "Valid"` (or `Invalid` once a hash is retired or the attestation expires).

4. **The sealed-notes key belongs to that enclave app.**
   `view get_agent_pubkey` returns the X25519 key and the Phala `app_id` (`d5b71473…`). The key is derived inside the enclave from the app's KMS key and never leaves it. The contract accepts it only from a registered agent and only while unset; changing it needs the contract owner.

5. **Only the contract can sign for the vaults, and only while a will is executing.**
   The vault addresses come from Chain Signatures under `inheirit.testnet` with the path `heirloom/<owner>/<chain>`, built by the contract itself. `request_signature` refuses unless the will is releasing that stage, or the owner asked for a withdrawal (`agent-contract/src/will/agent.rs`). Try: `view get_vault_paths '{"owner":"<any owner>"}'`.

6. **Private AI is attested.**
   The agent checks NEAR AI Cloud's attestation (Intel TDX quote, NVIDIA GPU, signing key bound to a fresh nonce) before sending any will text, and accepts only answers signed by that key (`src/ai/attestation.ts`). The app shows each check under *Signs of life*, in the "Private AI verified" details.

## What this doesn't prove

- **Who controls the Phala account.** With Phala's centralized key service, whoever controls it could deploy code that gets the same sealed-notes key; that code still couldn't register (step 2), but it could read notes. Every version deployed is published in `deploy/tee-agent.json`. Moving to an on-chain KMS with a timelocked allowlist is on the roadmap. See [`THREAT_MODEL.md`](THREAT_MODEL.md).
- **What a signed payload contains.** The contract decides *when* and *which vault* can be signed, not the transaction's contents; that rests on the attested code.
