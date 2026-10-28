// Where the sealed-notes key comes from (CLAUDE.md §7.5).
// In the TEE: dstack getKey("heirloom/sealed-notes", "x25519-v1"), derived by the Phala KMS from the
// CVM's app_id; it never touches disk. Locally there is no TEE, so a random dev seed is kept in
// DATA_DIR. That key is NOT protected and is only for local development.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DstackClient } from "@phala/dstack-sdk";
import { keypairFromSeed, type SealedKeypair } from "./crypto";

export const SEALED_KEY_PATH = "heirloom/sealed-notes";
export const SEALED_KEY_PURPOSE = "x25519-v1";
const DSTACK_SOCKET = "/var/run/dstack.sock";

export interface SealedKey {
  keypair: SealedKeypair;
  appId: string;
  tee: boolean;
}

export async function loadSealedKey(dataDir: string): Promise<SealedKey> {
  if (fs.existsSync(DSTACK_SOCKET)) {
    const client = new DstackClient();
    const { key } = await client.getKey(SEALED_KEY_PATH, SEALED_KEY_PURPOSE);
    const { app_id } = await client.info();
    const seed = Uint8Array.from(key.subarray(0, 32));
    key.fill(0);
    return { keypair: await keypairFromSeed(seed), appId: app_id, tee: true };
  }

  const file = path.join(dataDir, "dev-sealed-seed.hex");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  const seed = Uint8Array.from(Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex"));
  console.warn("[notes] LOCAL DEV sealed-notes key (no TEE): notes sealed to it are not protected");
  return { keypair: await keypairFromSeed(seed), appId: "local-dev", tee: false };
}
