import { KeyPair } from "@near-js/crypto";
import { describe, expect, it } from "vitest";
import { backupFile, pairingCode, parseBackup, parsePairing, recoveryLine } from "../web/src/lib/recovery";

const kp = KeyPair.fromRandom("ed25519");
const b = { account: "demo-1a2b3c4d.inheirit-users.testnet", key: kp.toString() };

describe("access recovery", () => {
  it("restores from the recovery line and from the file", () => {
    expect(parseBackup(recoveryLine(b))).toEqual(b);
    expect(parseBackup(backupFile(b))).toEqual(b);
    expect(parseBackup(`  ${recoveryLine(b)}\n`)).toEqual(b);
  });

  it("refuses damaged or foreign input in plain words", () => {
    expect(() => parseBackup("hello")).toThrow(/isn't an Inheirit recovery key/);
    expect(() => parseBackup(recoveryLine({ ...b, key: b.key.slice(0, 30) }))).toThrow(/damaged or incomplete/);
    expect(() => parseBackup(recoveryLine({ ...b, account: "Bad Name" }))).toThrow();
    expect(() => parseBackup("{not json")).toThrow(/isn't an Inheirit backup/);
  });

  it("adds a device by pairing code: the public key only, never a secret", () => {
    const pub = kp.getPublicKey().toString();
    const code = pairingCode(b.account, pub);
    expect(parsePairing(code)).toEqual({ account: b.account, publicKey: pub });
    expect(code).not.toContain(b.key.split(":")[1]);
    // A secret key pasted by mistake is refused.
    expect(() => parsePairing(`inheirit-pair:v1:${b.account}:${b.key}`)).toThrow(/isn't a device code/);
  });
});
