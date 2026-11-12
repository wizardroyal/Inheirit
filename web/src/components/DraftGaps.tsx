"use client";
// After a plain-English draft: ask only for what the owner didn't say (NEAR accounts, guardians,
// receive addresses), each with ↻ to generate a test one. The completed will is checked by the same
// code the agent uses (checkPolicy); nothing is invented without the owner seeing it.
import { useEffect, useRef, useState } from "react";
import { checkPolicy, type Policy } from "@agent/policy/policy";
import { STANDARD_PCT } from "@agent/policy/schedule";
import { agent } from "@/lib/agent";
import { createPerson } from "@/lib/onboard";
import { newTestReceive, testReceiveFor } from "@/lib/test-wallets";
import { GenerateButton, RefreshButton } from "./Onboarding";
import { ActionButton, inputCls } from "./ui";

/** Looks like a NEAR account rather than a bare name: named (has a dot) or implicit (64 hex). */
export const isAccount = (s: unknown) => typeof s === "string" && (/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(s) || /^[0-9a-f]{64}$/.test(s));

type Heir = { id: string; name: string; near_account?: string; receive?: { eth?: string; btc?: string }; [k: string]: unknown };
type Raw = Partial<Omit<Policy, "heirs" | "guardians">> & { heirs: Heir[]; guardians?: string[] };

/** "luka" → "Luka", "mary jane" → "Mary Jane"; names already capitalised stay as written. */
const title = (s: string) => s.replace(/(^|[\s-])(\p{Ll})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** True if the draft names at least one heir: everything else missing can be asked for here. */
export function hasGaps(draft: unknown): draft is Raw {
  const d = draft as Raw | null;
  return !!d && Array.isArray(d.heirs) && d.heirs.length > 0 && d.heirs.every((h) => h && typeof h.name === "string");
}

/** A share the model kept on the heir itself (some drafts do), else none. */
function ownShare(h: Heir): number | null {
  for (const k of ["share", "pct", "percent", "percentage"]) if (typeof h[k] === "number") return h[k] as number;
  return null;
}

export function DraftGaps({ owner, draft, onReady }: { owner: string; draft: Raw; onReady: (p: Policy | null, errors: string[]) => void }) {
  // Shares the model didn't record are asked for (pre-filled from the draft, else an equal split).
  // Shares are always editable here: a draft that adds up to 110% must be fixable without redrafting.
  const given = Array.isArray(draft.allocations) ? draft.allocations.find((a) => a?.asset === "NEAR" && a.shares) : undefined;
  const [pct, setPct] = useState<string[]>(() => {
    const n = draft.heirs.length;
    return draft.heirs.map((h, i) => String(given?.shares?.[h.id] ?? ownShare(h) ?? Math.floor(100 / n) + (i === n - 1 ? 100 - Math.floor(100 / n) * n : 0)));
  });
  const assetList = Array.isArray(draft.allocations) && draft.allocations.length ? [...new Set(draft.allocations.map((a) => a.asset))] : ["NEAR"];
  const shares = Object.fromEntries(draft.heirs.map((h, i) => [h.id, Number(pct[i])]));
  const allocations = assetList.map((asset) => ({ asset, shares })) as Policy["allocations"];
  const assets = new Set(allocations.map((a) => a.asset));
  const [heirs, setHeirs] = useState<Heir[]>(() => draft.heirs.map((h, i) => ({ id: h.id ?? `h${i + 1}`, name: title(h.name), near_account: h.near_account ?? "", receive: { ...h.receive } })));
  // Guardians the model wrote as bare names keep the name as a label; at least two slots.
  // A name given as both heir and guardian can't be both: it stays an heir, and a guardian slot opens.
  const heirNames = new Set(draft.heirs.map((h) => title(h.name)));
  const clashes = (draft.guardians ?? []).filter((x) => !isAccount(x) && heirNames.has(title(x))).map(title);
  const [guardians, setGuardians] = useState<{ label: string; account: string }[]>(() => {
    const g = (draft.guardians ?? []).filter((x) => isAccount(x) || !heirNames.has(title(x))).map((x) => (isAccount(x) ? { label: x, account: x } : { label: title(x), account: "" }));
    while (g.length < 2) g.push({ label: `Guardian ${g.length + 1}`, account: "" });
    return g;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pool = useRef<{ eth: string; btc: string } | null>(null);
  useEffect(() => {
    agent.faucetInfo().then((f) => (pool.current = f.enabled ? { eth: f.eth, btc: f.btc } : null)).catch(() => {});
  }, []);

  const needEth = assets.has("ETH");
  const needBtc = assets.has("BTC");
  const missing =
    heirs.filter((h) => !isAccount(h.near_account) || (needEth && !h.receive?.eth) || (needBtc && !h.receive?.btc)).length +
    guardians.filter((g) => !isAccount(g.account)).length;

  // Re-check the completed will with the agent's own rules on every change.
  useEffect(() => {
    if (missing) return onReady(null, []);
    const accounts = guardians.map((g) => g.account);
    const r = checkPolicy({
      ...draft,
      version: 1,
      owner,
      allocations,
      stages_pct: Array.isArray(draft.stages_pct) && draft.stages_pct.length ? draft.stages_pct : STANDARD_PCT,
      heirs: heirs.map((h) => ({ ...h, near_account: h.near_account!, receive: { ...(needEth ? { eth: h.receive!.eth } : {}), ...(needBtc ? { btc: h.receive!.btc } : {}) } })),
      guardians: accounts,
      guardian_threshold: Math.min(Math.max(draft.guardian_threshold || 2, 1), accounts.length),
    });
    onReady(r.ok ? (r.policy as Policy) : null, r.ok ? [] : r.errors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heirs, guardians, missing, pct.join()]);

  const setHeir = (i: number, patch: Partial<Heir>) => setHeirs((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch, receive: { ...h.receive, ...patch.receive } } : h)));
  const addresses = (i: number, hs: Heir[]) => testReceiveFor(hs.filter((_, k) => k !== i).map((o) => o.receive?.eth ?? ""), pool.current);

  async function fillAll() {
    setBusy(true);
    setError(null);
    try {
      const hs = [...heirs];
      for (let i = 0; i < hs.length; i++) {
        const h = { ...hs[i], receive: { ...hs[i].receive } };
        if (!isAccount(h.near_account)) {
          h.near_account = (await createPerson(owner, h.name)).accountId;
        }
        const recv = addresses(i, hs);
        if (needEth && !h.receive.eth) h.receive.eth = recv.eth;
        if (needBtc && !h.receive.btc) h.receive.btc = recv.btc;
        hs[i] = h;
        setHeirs([...hs]);
      }
      const gs = [...guardians];
      for (let i = 0; i < gs.length; i++) {
        if (isAccount(gs[i].account)) continue;
        const id = (await createPerson(owner, /^Guardian \d+$/.test(gs[i].label) ? undefined : gs[i].label)).accountId;
        gs[i] = { ...gs[i], account: id };
        setGuardians([...gs]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const total = pct.reduce((a, b) => a + (Number(b) || 0), 0);
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-lg">{missing ? "A few details are missing" : "Details"}</h3>
        {missing > 0 && (
          <ActionButton tone="quiet" disabled={busy} onClick={fillAll}>
            {busy ? "Generating…" : "Fill all with test people"}
          </ActionButton>
        )}
      </div>
      <p className={`text-xs ${total === 100 ? "text-muted" : "text-danger"}`}>Shares: {total}% of 100%</p>
      {clashes.length > 0 && <p className="text-xs text-muted">{clashes.join(", ")} can&apos;t be both heir and guardian, so stays an heir. Pick another guardian.</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      {heirs.map((h, i) => (
        <div key={h.id} className="space-y-2">
          <span className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{h.name}</p>
            {(
              <span className="relative w-24">
                <input
                  className={`${inputCls} w-full pr-7`}
                  inputMode="decimal"
                  aria-label={`${h.name}'s share in percent`}
                  value={pct[i]}
                  onChange={(e) => setPct((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
              </span>
            )}
          </span>
          {!isAccount(draft.heirs[i]?.near_account) && (
            <span className="flex items-start gap-2">
              <input className={`${inputCls} min-w-0 flex-1`} aria-label={`${h.name}'s NEAR account`} placeholder="NEAR account, or tap ↻" value={h.near_account ?? ""} onChange={(e) => setHeir(i, { near_account: e.target.value.trim() })} />
              <GenerateButton
                owner={owner}
                what="heir"
                name={h.name}
                onMade={(p) => {
                  setHeirs((hs) => hs.map((x, j) => (j === i ? { ...x, near_account: p.accountId } : x)));
                }}
              />
            </span>
          )}
          {(needEth || needBtc) && (!draft.heirs[i]?.receive?.eth || !draft.heirs[i]?.receive?.btc) && (
            <span className="flex flex-col gap-2 sm:flex-row sm:items-start">
              {needEth && <input className={`${inputCls} min-w-0 flex-1`} aria-label={`${h.name}'s Sepolia address`} placeholder="Sepolia address 0x…" value={h.receive?.eth ?? ""} onChange={(e) => setHeir(i, { receive: { eth: e.target.value.trim() } })} />}
              {needBtc && <input className={`${inputCls} min-w-0 flex-1`} aria-label={`${h.name}'s Bitcoin testnet address`} placeholder="BTC address tb1…" value={h.receive?.btc ?? ""} onChange={(e) => setHeir(i, { receive: { btc: e.target.value.trim() } })} />}
              <RefreshButton
                label={`Generate test addresses for ${h.name}`}
                onClick={() => {
                  const r = i === 0 ? addresses(i, heirs) : newTestReceive();
                  setHeir(i, { receive: { eth: r.eth, btc: r.btc } });
                }}
              />
            </span>
          )}
        </div>
      ))}
      {guardians.some((g) => !isAccount((draft.guardians ?? []).find((x) => x === g.account))) && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Guardians</p>
          {guardians.map((g, i) =>
            isAccount((draft.guardians ?? []).find((x) => x === g.account)) ? null : (
              <span key={i} className="flex items-start gap-2">
                <input
                  className={`${inputCls} min-w-0 flex-1`}
                  aria-label={`${g.label}'s NEAR account`}
                  placeholder={`${g.label}: NEAR account, or tap ↻`}
                  value={g.account}
                  onChange={(e) => setGuardians((gs) => gs.map((x, j) => (j === i ? { ...x, account: e.target.value.trim() } : x)))}
                />
                <GenerateButton
                  owner={owner}
                  what="guardian"
                  name={/^Guardian \d+$/.test(g.label) ? undefined : g.label}
                  onMade={(p) => {
                    setGuardians((gs) => gs.map((x, j) => (j === i ? { ...x, account: p.accountId } : x)));
                  }}
                />
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
