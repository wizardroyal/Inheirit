"use client";
// Editing and closing a will (only at All good), and the quiet period.
import { useState } from "react";
import { useAccount } from "@/lib/account";
import { agent } from "@/lib/agent";
import { DEMO_SCHEDULE } from "@/lib/config";
import { usePoll } from "@/lib/hooks";
import { call, nearToYocto, signRequest } from "@/lib/near";
import { configFromWill, isSpeedrun } from "@/lib/speedrun";
import { duration, type Will } from "@/lib/will";
import { QuietPeriod, realSchedule } from "../QuietPeriod";
import { ActionButton, Card } from "../ui";

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

/**
 * Close will (round 5): one sentence, a checkbox, the button. The contract can't see other chains, so the
 * Ethereum and Bitcoin vaults are checked through the agent and must be withdrawn first.
 */
export function CloseWill({ will }: { will: Will }) {
  const { refresh } = useAccount();
  const { data: vaults } = usePoll(() => agent.vaults(will.owner), 15_000, [will.owner]);
  const [sure, setSure] = useState(false);
  const left = will.foreign_chains.filter((c) => {
    const v = vaults?.[c];
    return !v || !("balance" in v) || Number(v.balance) > 0;
  });
  const blocked = left.length > 0 || will.pending_withdrawals.length > 0;
  return (
    <Card title="Close will">
      <p>Ends the will. Your NEAR comes back to you; sealed notes are deleted.</p>
      {blocked ? (
        <p className="mt-3 text-warn">Withdraw {left.map((c) => (c === "Eth" ? "your Ethereum" : "your Bitcoin")).join(" and ") || "the withdrawal in progress"} first, in Vault.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand
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
