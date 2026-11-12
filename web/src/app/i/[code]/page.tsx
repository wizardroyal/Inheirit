"use client";
// Invite links (round 5): https://inheirit.xyz/i/<code>. No owner or names in the URL; the contract's
// code index (find_invite) says which will the code belongs to.
import { useParams } from "next/navigation";
import { JoinView } from "@/components/JoinView";
import { ErrorNote, Skeleton } from "@/components/ui";
import { usePoll } from "@/lib/hooks";
import { findInvite } from "@/lib/invites";

export default function InvitePage() {
  const code = decodeURIComponent(useParams<{ code: string }>().code);
  const { data, loaded } = usePoll(() => findInvite(code), 60_000, [code]);
  if (!loaded) return <Skeleton />;
  if (!data) return <ErrorNote>This invite was already used, cancelled or has expired. Ask for a new link.</ErrorNote>;
  return <JoinView owner={data.owner} code={code} role={data.role} name="" />;
}
