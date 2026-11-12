"use client";
// My will: the will as plain text from a template (deterministic, not AI), then heirs, guardians, lawyer
// and friends, and the schedule. Edit and Close at the bottom.
import { CloseWill, EditWill } from "@/components/account/will";
import { WillGate } from "@/components/account/home";
import { People } from "@/components/account/people";
import { Card } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { agent } from "@/lib/agent";
import { savedPolicy } from "@/lib/demo";
import { useOverview, usePoll } from "@/lib/hooks";
import { formatNear } from "@/lib/near";
import { accountLabel, nameOf, useNames } from "@/lib/names";
import { duration, schedule, stateName, type Will } from "@/lib/will";

export default function MyWillPage() {
  return <WillGate>{(will) => <MyWill will={will} />}</WillGate>;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The will in plain words. Shares per asset come from the approved will when this browser has it. */
function WillText({ will }: { will: Will }) {
  const names = useNames();
  const { data: overview } = useOverview(will.owner);
  const { data: tokens } = usePoll(() => agent.intentsTokens().catch(() => null), 10 * 60_000, []);
  const nearUsd = tokens?.tokens.find((t) => t.symbol === "wNEAR" && t.blockchain === "near")?.price ?? null;
  const policy = savedPolicy(will.owner);
  const name = overview?.display_name ?? nameOf(will.owner) ?? "the owner";
  const vault = Number(formatNear(will.near_balance));
  const st = schedule(will);
  const total = st.reduce((s, x) => s + x.wait_after, 0);
  const foreign = will.foreign_chains.map((c) => (c === "Eth" ? "Ethereum" : "Bitcoin"));
  const sentences = will.heirs.map((h) => {
    const pct = h.near_share_bps / 100;
    const value = nearUsd && vault ? ` (≈ $${Math.round(vault * (pct / 100) * nearUsd).toLocaleString()} today)` : "";
    const id = policy?.heirs.find((p) => p.near_account === h.account_id)?.id;
    const other = foreign.map((label) => {
      const asset = label === "Ethereum" ? "ETH" : "BTC";
      const share = id ? policy?.allocations.find((a) => a.asset === asset)?.shares[id] : pct;
      return share === 100 ? `all my ${label}` : share ? `${share}% of my ${label}` : null;
    });
    const parts = [`${pct}% of my NEAR${value}`, ...other.filter((x): x is string => !!x)];
    return `${h.name} receives ${list(parts)}.`;
  });
  const g = will.guardians.map((x) => accountLabel(x.account_id, names));
  return (
    <section className="rounded-2xl border border-line bg-card p-6 sm:p-8">
      <h1 className="font-serif text-3xl sm:text-4xl">My will</h1>
      <div className="mt-5 max-w-2xl space-y-3 font-serif text-xl leading-relaxed">
        <p>
          I, {name}, leave my assets to {list(will.heirs.map((h) => h.name))}. {sentences.join(" ")}
        </p>
        <p>
          If I go quiet for {duration(will.timings.quiet_after)}, my guardians {list(g)} (any {will.guardian_threshold}) confirm. My assets are released in{" "}
          {st.length} stages over about {duration(total)}.{will.sealed_notes.length > 0 ? " My final secrets reach my heirs last." : ""}
        </p>
      </div>
    </section>
  );
}

function MyWill({ will }: { will: Will }) {
  const { refresh, viewing } = useAccount();
  const st = schedule(will);
  const active = stateName(will.state) === "Active";
  return (
    <div className="space-y-6">
      <WillText will={will} />
      <People will={will} />
      <Card title="Schedule">
        <ol className="space-y-2 text-lg">
          {st.map((x, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-3">
              <span>
                Stage {i + 1}: {x.pct}%
              </span>
              <span className="text-muted">then wait {duration(x.wait_after)}</span>
            </li>
          ))}
          <li className="flex flex-wrap justify-between gap-3 text-muted">
            <span>Final secrets</span>
            <span>after {duration(will.timings.secrets_buffer)} more</span>
          </li>
        </ol>
      </Card>
      {!viewing && active && (
        <div className="grid gap-6 lg:grid-cols-2">
          <EditWill will={will} refresh={refresh} />
          <CloseWill will={will} refresh={refresh} />
        </div>
      )}
      {!viewing && !active && <p className="text-muted">The will can be edited or closed only at All good.</p>}
    </div>
  );
}
