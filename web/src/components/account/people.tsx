"use client";
// People on the will (shown on My will): heirs, guardians, friends and the lawyer, with their status.
import { InviteByLink } from "@/components/account/parts";
import { ActionButton, Card, CopyLink, Pill } from "@/components/ui";
import { useAccount } from "@/lib/account";
import { useAccountLabel } from "@/lib/names";
import { call } from "@/lib/near";
import { stateName, type Will } from "@/lib/will";

export function People({ will }: { will: Will }) {
  const { refresh, viewing } = useAccount();
  const label = useAccountLabel();
  const active = stateName(will.state) === "Active" && !viewing;
  const accepted = will.guardians.filter((g) => g.accepted).length;
  const row = (name: string, status: React.ReactNode, action?: React.ReactNode) => (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="text-lg">{name}</span>
      <span className="flex items-center gap-3">
        {status}
        {action}
      </span>
    </li>
  );
  return (
    <div className="space-y-6">
      <Card title="Heirs">
        <ul className="divide-y divide-line">{will.heirs.map((h) => row(h.name, <span className="text-muted">{h.near_share_bps / 100}%</span>))}</ul>
      </Card>
      <Card title={`Guardians · ${will.guardian_threshold} must confirm`}>
        <ul className="divide-y divide-line">
          {will.guardians.map((g) =>
            row(
              label(g.account_id),
              <Pill tone={g.accepted ? "accent" : "warn"}>{g.accepted ? "accepted" : "invited"}</Pill>,
              active && will.guardians.length > will.guardian_threshold ? (
                <ActionButton tone="quiet" onClick={() => call(will.owner, "remove_guardian", { account: g.account_id }).then(refresh)}>
                  Remove
                </ActionButton>
              ) : undefined,
            ),
          )}
        </ul>
        {accepted < will.guardian_threshold && !viewing && (
          <div className="mt-3 space-y-1">
            <p>Waiting for {will.guardian_threshold - accepted} more to accept. Send them their link (resend any time):</p>
            <CopyLink path={`/guardian/${will.owner}`} />
          </div>
        )}
      </Card>
      <Card title="Friends for welfare checks">
        {will.contacts.length ? <ul className="divide-y divide-line">{will.contacts.map((c) => row(label(c), <span className="text-muted">can only stop things</span>))}</ul> : <p className="text-muted">None yet.</p>}
      </Card>
      <Card title="Lawyer">
        {will.lawyer ? <ul>{row(label(will.lawyer), <span className="text-muted">can speed up, never skip</span>)}</ul> : <p className="text-muted">None yet.</p>}
      </Card>
      {active && (
        <Card title="Add someone">
          <InviteByLink owner={will.owner} hasLawyer={!!will.lawyer} will={will} />
        </Card>
      )}
    </div>
  );
}
