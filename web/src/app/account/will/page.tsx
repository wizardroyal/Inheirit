"use client";
// My will: the will in plain sentences, who gets what, the schedule; edit it or close it.
import { EditWill, CloseWill } from "@/components/account/will";
import { WillGate } from "@/components/account/home";
import { Card } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { useAccountLabel } from "@/lib/names";
import { duration, schedule, stateName, type Will } from "@/lib/will";

export default function MyWillPage() {
  return <WillGate>{(will) => <MyWill will={will} />}</WillGate>;
}

function MyWill({ will }: { will: Will }) {
  const { refresh, viewing } = useAccount();
  const label = useAccountLabel();
  const st = schedule(will);
  const total = st.reduce((s, x) => s + x.wait_after, 0);
  const g = will.guardians;
  const vaults = ["NEAR", ...will.foreign_chains.map((c) => (c === "Eth" ? "Sepolia ETH" : "testnet BTC"))];
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-card p-6 sm:p-8">
        <h1 className="font-serif text-3xl sm:text-4xl">My will</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed">
          If you go quiet for {duration(will.timings.quiet_after)} and nobody has heard from you, {will.guardian_threshold} of your {g.length} guardians
          ({g.map((x) => label(x.account_id)).join(", ")}) are asked to confirm. After a {duration(will.timings.challenge_period)} challenge period, your{" "}
          {vaults.join(", ")} {vaults.length > 1 ? "go" : "goes"} to {will.heirs.map((h) => h.name).join(" and ")} in {st.length} slices over about {duration(total)}.
          {will.sealed_notes.length > 0 && ` Then ${will.sealed_notes.length} sealed note${will.sealed_notes.length > 1 ? "s are" : " is"} released, last.`}
        </p>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Who gets what">
          <ul className="space-y-2 text-lg">
            {will.heirs.map((h) => (
              <li key={h.account_id} className="flex justify-between gap-3">
                <span>{h.name}</span>
                <span className="text-muted">{h.near_share_bps / 100}%</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Schedule">
          <ol className="space-y-2 text-lg">
            {st.map((x, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>Slice {i + 1}: {x.pct}%</span>
                <span className="text-muted">then wait {duration(x.wait_after)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 text-muted">
              <span>Final secrets</span>
              <span>after {duration(will.timings.secrets_buffer)} more</span>
            </li>
          </ol>
        </Card>
      </div>
      {!viewing && stateName(will.state) === "Active" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <EditWill will={will} refresh={refresh} />
          <CloseWill will={will} refresh={refresh} />
        </div>
      )}
      {!viewing && stateName(will.state) !== "Active" && <p className="text-muted">The will can be edited or closed only at All good.</p>}
    </div>
  );
}
