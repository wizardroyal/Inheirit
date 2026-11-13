// Access recovery (judge feedback, Nov 13): an account's key lives only in the browser that made it, so a
// lost browser meant a lost will. These helpers are pure (no browser APIs) and unit-tested from test/.
// We never hold keys: the backup is a file or a line of text the owner keeps.

const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;
const SECRET = /^ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}$/;

export interface Backup {
  account: string;
  key: string;
}

/** The one-line recovery key: shown once, and also inside the downloadable file. */
export function recoveryLine(b: Backup): string {
  return `inheirit-recovery:v1:${b.account}:${b.key}`;
}

/** The downloadable file's contents. */
export function backupFile(b: Backup): string {
  return JSON.stringify({ kind: "inheirit-recovery", v: 1, account: b.account, key: b.key, line: recoveryLine(b) }, null, 2);
}

/** Reads a backup: the recovery line, or the file's JSON. Throws a plain-English error otherwise. */
export function parseBackup(input: string): Backup {
  const text = input.trim();
  let account = "";
  let key = "";
  if (text.startsWith("{")) {
    try {
      const j = JSON.parse(text) as { account?: string; key?: string };
      account = j.account ?? "";
      key = j.key ?? "";
    } catch {
      throw new Error("That file isn't an Inheirit backup.");
    }
  } else {
    const m = /^inheirit-recovery:v1:([^:]+):(ed25519:\S+)$/.exec(text);
    if (!m) throw new Error("That isn't an Inheirit recovery key. It starts with “inheirit-recovery:v1:”.");
    [, account, key] = m;
  }
  if (!ACCOUNT.test(account)) throw new Error("The backup names an account that isn't valid.");
  if (!SECRET.test(key)) throw new Error("The key in this backup is damaged or incomplete.");
  return { account, key };
}
