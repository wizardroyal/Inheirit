// Releases sealed notes to heirs once a will reaches SecretsReleased: after distribution and the
// secrets buffer (CLAUDE.md §5.5). The will stays there until every note is out, so heirs who
// register late still get theirs.
// The contract enforces the same rules (state, heir match, heir key, once per note); these checks
// avoid spending gas on calls that would fail.
import type { WillContract, WillView } from "../near/will-contract";
import { stateName } from "../near/will-contract";
import { reseal, toHex, type SealedKeypair } from "./crypto";

export class NoteReleaser {
  /** Notes this key cannot open (sealed to another key); logged once, not retried every tick. */
  private readonly unopenable = new Set<string>();

  constructor(
    private readonly contract: WillContract,
    /** null when sealed-note work is disabled (key mismatch with the contract) */
    private readonly keypair: SealedKeypair | null,
    private readonly log: (msg: string) => void = (m) => console.log(m),
  ) {}

  /** Returns how many notes were released this call. */
  async run(will: WillView): Promise<number> {
    if (!this.keypair) return 0;
    const state = stateName(will.state);
    if (state !== "SecretsReleased") return 0;

    let released = 0;
    for (const note of will.sealed_notes) {
      const ref = `${will.owner}:${note.id}`;
      if (this.unopenable.has(ref)) continue;
      if (will.released_notes.some((r) => r.note_id === note.id)) continue;
      const heirKey = will.heirs.find((h) => h.account_id === note.heir)?.x25519_pubkey;
      if (!heirKey) continue; // the heir hasn't registered a key yet

      let ciphertext: Uint8Array;
      try {
        ciphertext = await reseal(Buffer.from(note.ciphertext, "base64"), this.keypair, heirKey);
      } catch {
        this.unopenable.add(ref);
        this.log(`[notes] ${will.owner}: note ${note.id} can't be opened with this agent's key; the owner must re-seal it`);
        continue;
      }
      await this.contract.storeReleasedNote(will.owner, note.id, note.heir, Buffer.from(ciphertext).toString("base64"));
      released++;
      this.log(`[notes] ${will.owner}: note ${note.id} ("${note.label}") released to ${note.heir}`);
    }
    return released;
  }
}

/**
 * Boot check (§7.5): publish the key if the contract has none; refuse sealed-note work if the
 * contract holds a different key. Never overwrite it: a new app_id would strand every existing note.
 */
export async function ensureAgentKey(
  contract: WillContract,
  keypair: SealedKeypair,
  appId: string,
  log: (msg: string) => void = (m) => console.error(m),
): Promise<boolean> {
  const mine = toHex(keypair.publicKey);
  const onChain = await contract.getAgentPubkey();
  if (!onChain) {
    await contract.setAgentPubkey(mine, appId);
    log(`[notes] published sealed-notes key ${mine} (app_id ${appId})`);
    return true;
  }
  if (onChain.x25519_pubkey === mine) return true;
  log(
    `[notes] KEY MISMATCH: contract has ${onChain.x25519_pubkey} (app_id ${onChain.app_id}), this agent derives ${mine} ` +
      `(app_id ${appId}). Sealed-note work is DISABLED. Rotating needs the contract owner (rotate_agent_pubkey).`,
  );
  return false;
}
