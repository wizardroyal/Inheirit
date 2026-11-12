"use client";
// Editing and closing a will (only at All good), and the quiet period.
import { useState } from "react";
import { agent } from "@/lib/agent";
import { DEMO_SCHEDULE } from "@/lib/config";
import { usePoll } from "@/lib/hooks";
import { call, nearToYocto, signRequest } from "@/lib/near";
import { configFromWill, isSpeedrun } from "@/lib/speedrun";
import { duration, type Will } from "@/lib/will";
import { QuietPeriod, realSchedule } from "../QuietPeriod";
import { ActionButton, Card, Field, inputCls } from "../ui";

const DAY = 86_400;

/** Writes the will's config back with changes; the agent is told so it keeps watching. */
async function saveConfig(w: Will, patch: { threshold?: number; sharesBps?: number[]; quietDays?: number }) {
  const preset = isSpeedrun(w) ? DEMO_SCHEDULE : realSchedule(patch.quietDays ?? Math.round(w.timings.quiet_after / DAY));
  const config = configFromWill(w, preset);
  if (patch.threshold) config.guardian_threshold = patch.threshold;
  if (patch.sharesBps) config.heirs = config.heirs.map((h, i) => ({ ...h, near_share_bps: patch.sharesBps![i] }));
  await call(w.owner, "update_will", { config }, nearToYocto("0.02"));
  await agent.registerOwner(await signRequest(w.owner, "register_owner", {}));
}

export function EditWill({ will, refresh }: { will: Will; refresh: () => void }) {
  const [threshold, setThreshold] = useState(String(will.guardian_threshold));
  const [shares, setShares] = useState(will.heirs.map((h) => String(h.near_share_bps / 100)));
  const [done, setDone] = useState(false);
  const total = shares.reduce((s, x) => s + (Number(x) || 0), 0);
  const t = Number(threshold);
  const ok = total === 100 && shares.every((x) => Number.isInteger(Number(x)) && Number(x) >= 0) && Number.isInteger(t) && t >= 1 && t <= will.guardians.length;
  return (
    <Card title="Edit will">
      <div className="space-y-3">
        {will.heirs.map((h, i) => (
          <Field key={h.account_id} label={`${h.name}'s share of the NEAR vault`}>
            <input className={`${inputCls} w-24`} inputMode="numeric" value={shares[i]} onChange={(e) => setShares((s) => s.map((x, j) => (j === i ? e.target.value : x)))} />
          </Field>
        ))}
        <p className={total === 100 ? "text-sm text-muted" : "text-sm text-danger"}>Shares: {total}% of 100%</p>
        <Field label={`Guardians who must confirm (of ${will.guardians.length})`}>
          <input className={`${inputCls} w-24`} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </Field>
        <p className="text-sm text-muted">Add or remove guardians under People; new ones count once they accept.</p>
        <ActionButton
          disabled={!ok}
          onClick={async () => {
            await saveConfig(will, { threshold: t, sharesBps: shares.map((x) => Math.round(Number(x) * 100)) });
            setDone(true);
            refresh();
          }}
        >
          Save changes
        </ActionButton>
        {done && <span className="ml-2 text-sm text-accent">Saved.</span>}
      </div>
    </Card>
  );
}

/**
 * Closing the will returns the NEAR vault. The contract can't see other chains, so this checks the
 * Sepolia and Bitcoin vaults through the agent and asks for those to be withdrawn first.
 */
export function CloseWill({ will, refresh }: { will: Will; refresh: () => void }) {
  const { data: vaults } = usePoll(() => agent.vaults(will.owner), 15_000, [will.owner]);
  const [sure, setSure] = useState(false);
  const left = will.foreign_chains.filter((c) => {
    const v = vaults?.[c];
    return !v || !("balance" in v) || Number(v.balance) > 0;
  });
  const blocked = left.length > 0 || will.pending_withdrawals.length > 0;
  return (
    <Card title="Close will">
      <p className="text-muted">Ends the will for good: the NEAR vault and storage deposit come back to you, and sealed notes are deleted.</p>
      {blocked ? (
        <p className="mt-3 text-warn">
          Withdraw these first: {left.map((c) => (c === "Eth" ? "the Sepolia vault" : "the Bitcoin vault")).join(" and ") || "a withdrawal is still being sent"}. (The
          contract can&apos;t see other chains; the app checks those vaults before closing.)
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand this can&apos;t be undone
          </label>
          <ActionButton tone="danger" disabled={!sure} onClick={() => call(will.owner, "close_will").then(refresh)}>
            Close will
          </ActionButton>
        </div>
      )}
    </Card>
  );
}

/** The quiet period (real timings): suggested from the owner's history, saved with update_will. */
export function QuietSetting({ will }: { will: Will }) {
  const [days, setDays] = useState<number | null>(Math.round(will.timings.quiet_after / DAY));
  const [saved, setSaved] = useState(false);
  if (isSpeedrun(will))
    return (
      <Card title="Quiet period">
        <p className="text-muted">This will is on demo timings ({duration(will.timings.quiet_after)}). Switch back to real timings on the speedrun page.</p>
      </Card>
    );
  return (
    <Card title="Quiet period">
      <p className="mb-3 text-muted">Now: checks start after {duration(will.timings.quiet_after)} of silence.</p>
      <QuietPeriod owner={will.owner} value={days} onChange={(d) => (setDays(d), setSaved(false))} />
      <div className="mt-3">
        <ActionButton tone="quiet" disabled={!days || days < 1 || days > 365} onClick={async () => (await saveConfig(will, { quietDays: days! }), setSaved(true))}>
          Save
        </ActionButton>
        {saved && <span className="ml-2 text-sm text-accent">Saved.</span>}
      </div>
    </Card>
  );
}
