import sodium from "libsodium-wrappers";
import { beforeAll, describe, expect, it } from "vitest";
import type { WillContract, WillState, WillView } from "../src/near/will-contract";
import { keypairFromSeed, openSealed, reseal, sealTo, toHex, type SealedKeypair } from "../src/sealed/crypto";
import { ensureAgentKey, NoteReleaser } from "../src/sealed/releaser";

let agent: SealedKeypair;
let heir: SealedKeypair;
beforeAll(async () => {
  await sodium.ready;
  agent = await keypairFromSeed(new Uint8Array(32).fill(7));
  heir = await keypairFromSeed(new Uint8Array(32).fill(9));
});

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

function will(state: WillState, extra: Partial<WillView> = {}): WillView {
  return {
    owner: "alice.testnet",
    heirs: [{ account_id: "bola.testnet", name: "Bola", near_share_bps: 10_000, x25519_pubkey: toHex(heir.publicKey) }],
    guardians: [],
    guardian_threshold: 1,
    contacts: [],
    stages: [{ pct: 100, wait_after: 1 }],
    accelerated_stages: [{ pct: 100, wait_after: 1 }],
    round_stages: [{ pct: 100, wait_after: 1 }],
    timings: { quiet_after: 1, nudge_period: 1, welfare_period: 1, vote_period: 1, challenge_period: 1, secrets_buffer: 1 },
    policy_hash: "0".repeat(64),
    foreign_chains: [],
    lawyer: null,
    heirs_hidden: true,
    accelerated: false,
    state,
    last_alive_at: 0,
    execution_round: 0,
    near_balance: "0",
    pending_withdrawals: [],
    executions: [],
    stage_done: [],
    sealed_notes: [],
    released_notes: [],
    ...extra,
  };
}

class FakeContract implements Partial<WillContract> {
  key: { x25519_pubkey: string; app_id: string } | null = null;
  stored: { owner: string; noteId: number; heir: string; ciphertext: string }[] = [];
  async getAgentPubkey() {
    return this.key;
  }
  async setAgentPubkey(x25519_pubkey: string, app_id: string) {
    this.key = { x25519_pubkey, app_id };
  }
  async storeReleasedNote(owner: string, noteId: number, heirId: string, ciphertext: string) {
    this.stored.push({ owner, noteId, heir: heirId, ciphertext });
  }
}

const RELEASED: WillState = { SecretsReleased: { since: 0 } };

describe("sealed note crypto", () => {
  it("re-seals a note from the agent key to the heir key", async () => {
    const note = await sealTo("The Ledger is in the blue folder in the study", toHex(agent.publicKey));
    const released = await reseal(note, agent, toHex(heir.publicKey));
    expect(await openSealed(released, heir)).toBe("The Ledger is in the blue folder in the study");
    await expect(openSealed(released, agent)).rejects.toThrow();
  });

  it("derives the same keypair from the same seed", async () => {
    const again = await keypairFromSeed(new Uint8Array(32).fill(7));
    expect(toHex(again.publicKey)).toBe(toHex(agent.publicKey));
  });

  it("rejects a seed that is not 32 bytes", async () => {
    await expect(keypairFromSeed(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });
});

describe("NoteReleaser", () => {
  async function noteFor(heirAccount = "bola.testnet", id = 0, text = "secret") {
    return { id, heir: heirAccount, label: "where", ciphertext: b64(await sealTo(text, toHex(agent.publicKey))) };
  }

  it("releases each note to its heir once the will reaches SecretsReleased", async () => {
    const c = new FakeContract();
    const r = new NoteReleaser(c as unknown as WillContract, agent, () => {});
    const n = await r.run(will(RELEASED, { sealed_notes: [await noteFor()] }));
    expect(n).toBe(1);
    expect(c.stored).toHaveLength(1);
    expect(c.stored[0]).toMatchObject({ owner: "alice.testnet", noteId: 0, heir: "bola.testnet" });
    expect(await openSealed(Buffer.from(c.stored[0].ciphertext, "base64"), heir)).toBe("secret");
  });

  it("never releases while funds are moving or before (secrets last)", async () => {
    const c = new FakeContract();
    const r = new NoteReleaser(c as unknown as WillContract, agent, () => {});
    for (const s of [
      "Active",
      { Challenge: { since: 1 } },
      { GuardianVote: { since: 1 } },
      { Executing: { stage: 0, since: 0, stage_started: 0 } },
      { SecretsBuffer: { since: 1 } },
    ] as WillState[]) {
      expect(await r.run(will(s, { sealed_notes: [await noteFor()] }))).toBe(0);
    }
    expect(c.stored).toHaveLength(0);
  });

  it("skips notes already released and heirs without a key", async () => {
    const c = new FakeContract();
    const r = new NoteReleaser(c as unknown as WillContract, agent, () => {});
    const w = will(RELEASED, {
      heirs: [
        { account_id: "bola.testnet", name: "Bola", near_share_bps: 5_000, x25519_pubkey: toHex(heir.publicKey) },
        { account_id: "cara.testnet", name: "Cara", near_share_bps: 5_000, x25519_pubkey: null },
      ],
      sealed_notes: [await noteFor("bola.testnet", 0), await noteFor("cara.testnet", 1), await noteFor("bola.testnet", 2)],
      released_notes: [{ note_id: 0, heir: "bola.testnet" }],
    });
    expect(await r.run(w)).toBe(1);
    expect(c.stored.map((s) => s.noteId)).toEqual([2]);
  });

  it("logs a note it cannot open once, without throwing or retrying", async () => {
    const c = new FakeContract();
    const logs: string[] = [];
    const r = new NoteReleaser(c as unknown as WillContract, agent, (m) => logs.push(m));
    const other = await keypairFromSeed(new Uint8Array(32).fill(1));
    const bad = { id: 5, heir: "bola.testnet", label: "x", ciphertext: b64(await sealTo("x", toHex(other.publicKey))) };
    const w = will(RELEASED, { sealed_notes: [bad] });
    expect(await r.run(w)).toBe(0);
    expect(await r.run(w)).toBe(0);
    expect(logs.filter((l) => l.includes("note 5"))).toHaveLength(1);
    expect(c.stored).toHaveLength(0);
  });

  it("does nothing when sealed-note work is disabled (no key)", async () => {
    const c = new FakeContract();
    const r = new NoteReleaser(c as unknown as WillContract, null, () => {});
    expect(await r.run(will(RELEASED, { sealed_notes: [await noteFor()] }))).toBe(0);
  });
});

describe("ensureAgentKey", () => {
  it("publishes the key when the contract has none", async () => {
    const c = new FakeContract();
    expect(await ensureAgentKey(c as unknown as WillContract, agent, "app1", () => {})).toBe(true);
    expect(c.key).toEqual({ x25519_pubkey: toHex(agent.publicKey), app_id: "app1" });
  });

  it("accepts a matching key without writing", async () => {
    const c = new FakeContract();
    c.key = { x25519_pubkey: toHex(agent.publicKey), app_id: "app1" };
    const set = c.setAgentPubkey.bind(c);
    let calls = 0;
    c.setAgentPubkey = async (...a) => {
      calls++;
      return set(...a);
    };
    expect(await ensureAgentKey(c as unknown as WillContract, agent, "app1", () => {})).toBe(true);
    expect(calls).toBe(0);
  });

  it("refuses sealed-note work on a mismatch and never overwrites", async () => {
    const c = new FakeContract();
    c.key = { x25519_pubkey: toHex(heir.publicKey), app_id: "old-app" };
    const logs: string[] = [];
    expect(await ensureAgentKey(c as unknown as WillContract, agent, "new-app", (m) => logs.push(m))).toBe(false);
    expect(c.key.x25519_pubkey).toBe(toHex(heir.publicKey));
    expect(logs.join()).toMatch(/mismatch/i);
  });
});
