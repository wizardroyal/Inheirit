"use client";
// Activity: what was sent and what happened; the technical record, collapsed.
import { WillGate } from "@/components/account/home";
import { AgentBadge, AiBadge } from "@/components/Attestation";
import { Ladder } from "@/components/Ladder";
import { Card, Details } from "@/components/ui";
import { NotificationLog } from "@/components/WillParts";
import { CONTRACT_ID } from "@/lib/config";

export default function ActivityPage() {
  return (
    <WillGate>
      {(will) => (
        <div className="space-y-6">
          <h1 className="font-serif text-3xl sm:text-4xl">Activity</h1>
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <Card title="Messages sent">
              <NotificationLog owner={will.owner} />
            </Card>
            <Card title="Where it stands">
              <Ladder will={will} />
            </Card>
          </div>
          <Details summary="Technical details">
            <div className="tech space-y-3 text-xs">
              <AgentBadge />
              <AiBadge />
              <div>contract {CONTRACT_ID}</div>
              <div>owner {will.owner}</div>
              <div>policy hash {will.policy_hash}</div>
              <div>execution round {will.execution_round}</div>
            </div>
          </Details>
        </div>
      )}
    </WillGate>
  );
}
