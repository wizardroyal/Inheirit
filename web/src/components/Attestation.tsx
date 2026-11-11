"use client";
// Trust badges: the agent's TEE registration on the contract, its sealed-notes key, and NEAR AI
// Cloud's private-inference attestation (checked by the agent with a fresh nonce).
import { agent } from "@/lib/agent";
import { CONTRACT_ID, explorer } from "@/lib/config";
import { usePoll } from "@/lib/hooks";
import { view } from "@/lib/near";
import type { AgentKey } from "@/lib/will";
import { Details, ExtLink, Pill } from "./ui";

interface ContractInfo {
  requires_tee: boolean;
  owner_id: string;
  mpc_contract_id: string;
}
interface Measurements {
  app_compose_hash_payload: string;
}
interface AgentView {
  account_id: string;
  measurements: Measurements;
  validity: unknown;
}

export function AgentBadge() {
  const { data } = usePoll(
    async () => {
      const [info, key, contract, approved, agents] = await Promise.all([
        agent.info().catch(() => null),
        view<AgentKey | null>("get_agent_pubkey"),
        view<ContractInfo>("get_contract_info"),
        view<Measurements[]>("get_approved_measurements", {}),
        view<AgentView[]>("get_agents", {}),
      ]);
      return { info, key, contract, approved, agents };
    },
    30_000,
  );
  if (!data) return <Pill>checking agent…</Pill>;
  const { info, key, contract, approved, agents } = data;
  const valid = agents.filter((a) => a.validity === "Valid");
  const keyMatches = !!info && !!key && info.sealedNotes.x25519_pubkey === key.x25519_pubkey;
  const tee = contract.requires_tee;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-2">
        {tee ? <Pill tone="accent">Agent runs in a secure enclave (Intel TDX)</Pill> : <Pill tone="warn">local development agent, no enclave</Pill>}
        {valid.length > 0 ? <Pill tone="accent">attested agent registered on-chain</Pill> : <Pill tone="danger">no attested agent registered</Pill>}
        {keyMatches ? <Pill tone="accent">sealed-notes key matches the contract</Pill> : <Pill tone="warn">sealed-notes key not confirmed yet</Pill>}
      </div>
      <Details summary="Technical details">
        <div>
          contract: <ExtLink href={explorer.nearAccount(CONTRACT_ID)}>{CONTRACT_ID}</ExtLink> (requires_tee: {String(tee)})
        </div>
        <div>MPC signer: {contract.mpc_contract_id}</div>
        <div>approved compose hashes: {approved.map((m) => m.app_compose_hash_payload).join(", ") || "none"}</div>
        {valid.map((a) => (
          <div key={a.account_id}>
            agent {a.account_id.slice(0, 12)}… compose {a.measurements.app_compose_hash_payload}
          </div>
        ))}
        {key && (
          <div>
            sealed-notes key {key.x25519_pubkey} · app_id {key.app_id}
          </div>
        )}
        {info && <div>agent reports: tee={String(info.sealedNotes.tee)} enabled={String(info.sealedNotes.enabled)}</div>}
        <div className="pt-1 font-sans">
          A caveat: with Phala&apos;s centralized key service, whoever controls our Phala account could ship new code that receives the same key.
          That&apos;s why every version we deploy is published, and the approved ones are listed above. See the threat model.
        </div>
      </Details>
    </div>
  );
}

export function AiBadge() {
  const { data, error } = usePoll(() => agent.aiAttestation(), 10 * 60_000);
  if (error) return <Pill tone="warn">NEAR AI: {error.includes("not configured") ? "not configured" : "unavailable"}</Pill>;
  if (!data) return <Pill>checking NEAR AI…</Pill>;
  const checks = [...(data.gateway?.checks ?? []), ...data.models.flatMap((m) => m.checks)];
  return (
    <div className="space-y-2 text-sm">
      {data.ok ? <Pill tone="accent">Private AI verified ({data.model})</Pill> : <Pill tone="danger">NEAR AI attestation failed</Pill>}
      <Details summary={`${checks.filter((c) => c.ok).length}/${checks.length} checks passed · ${new Date(data.checkedAt).toLocaleTimeString()}`}>
        {checks.map((c, i) => (
          <div key={i}>
            {c.ok ? "✓" : "✗"} {c.name}
            {c.detail ? ` — ${c.detail}` : ""}
          </div>
        ))}
        <div>attested model signers: {data.attestedSigners.join(", ")}</div>
        <div>nonce: {data.nonce}</div>
        {data.error && <div>error: {data.error}</div>}
      </Details>
    </div>
  );
}
