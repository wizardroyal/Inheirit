"use client";
// "Set your will in motion" (CLAUDE.md §13A.1 items 5–6): a scenario picker and a live checklist on the
// owner's own will, plus a role switcher so one person can play owner, guardians, heir, lawyer and friend.
import { useAccountLabel } from "@/lib/names";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useKeys } from "@/lib/hooks";
import { keys } from "@/lib/keys";
import { canSign } from "@/lib/near";
import { attestDeceased, fileDeathProof, isSpeedrun, registerHeirKey, SCENARIOS, setTimings, signOfLife, startOver, type Scenario } from "@/lib/speedrun";
import { acceptedGuardians, LADDER, stateName, type StateName, type Will } from "@/lib/will";
import { ActionButton, Card, Pill } from "./ui";

const order = (s: StateName) => LADDER.findIndex((l) => l.state === s);
const reached = (w: Will, s: StateName) => order(stateName(w.state)) >= order(s);

function useStored<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved) setV(saved as T);
    } catch {
      // storage blocked: keep the default
    }
  }, [key]);
  return [
    v,
    (x: T) => {
      setV(x);
      try {
        window.localStorage.setItem(key, x);
      } catch {
        // ignore
      }
    },
  ];
}

interface Step {
  label: string;
  detail: string;
  done: boolean;
  action?: { label: string; run: () => Promise<unknown>; enabled: boolean; tone?: "danger" | "quiet" };
  link?: { label: string; href: string };
}

function steps(w: Will, scenario: Scenario, escalated: boolean): Step[] {
  const owner = w.owner;
  const s = stateName(w.state);
  const heir = w.heirs[0];
  const voters = acceptedGuardians(w).filter(canSign).slice(0, w.guardian_threshold);
  const silent: Step = {
    label: "Go silent",
    detail: "Do nothing as the owner for about 2 minutes (any transaction you sign counts as a sign of life). The ladder above climbs on its own.",
    done: escalated || s !== "Active",
  };
  if (scenario === "returns") {
    return [
      silent,
      {
        label: "Checks go out",
        detail: "The agent checks in with you (the heartbeat app, Telegram if linked; email and DMs appear in the log), then asks your friends and guardians.",
        done: escalated && (s === "Active" || reached(w, "WelfareCheck")),
      },
      {
        label: "Send a sign of life",
        detail: "Send a signed heartbeat, as if you'd opened the heartbeat app. Watch the ladder snap back to All good. Nothing moves.",
        done: escalated && s === "Active",
        action: { label: "I'm here (send a heartbeat)", run: () => signOfLife(owner), enabled: s !== "Active" && s !== "Completed" },
      },
    ];
  }
  const out: Step[] = [];
  if (heir) {
    out.push({
      label: `As ${heir.name}, create the key for sealed notes`,
      detail: "Notes are released last, re-sealed to a key only the heir holds. Any time before the end is fine.",
      done: !!heir.x25519_pubkey,
      action: canSign(heir.account_id) ? { label: `Create ${heir.name}'s key`, run: () => registerHeirKey(owner, heir.account_id), enabled: !heir.x25519_pubkey } : undefined,
    });
  }
  if (scenario === "late-heir") {
    out.push({
      label: `Don't choose ${heir?.name ?? "the heir"}'s payout yet`,
      detail: "Released slices wait for the heir to choose instead of paying out (NEAR Intents, SIMULATED on testnet).",
      done: reached(w, "Executing"),
    });
  }
  out.push({ ...silent, done: reached(w, "GuardianVote") });
  if (scenario === "accelerated" && w.lawyer) {
    out.push({
      label: "As the lawyer, file a death certificate",
      detail: "The evidence is SIMULATED (the fingerprint of a demo text). It shortens the remaining waits, but never skips the guardian vote or the challenge period.",
      done: w.accelerated,
      action: canSign(w.lawyer)
        ? { label: "File the death certificate", run: () => fileDeathProof(w.lawyer!, owner), enabled: ["GuardianVote", "Challenge", "Executing"].includes(s) && !w.accelerated, tone: "quiet" }
        : undefined,
    });
  }
  out.push({
    label: `As ${w.guardian_threshold} guardians, confirm the passing`,
    detail: "Only accepted guardians count (they accepted when the will was generated). Nothing can start without enough of them.",
    done: reached(w, "Challenge"),
    action:
      voters.length >= w.guardian_threshold
        ? {
            label: w.guardian_threshold === 2 ? "Both guardians confirm" : `${w.guardian_threshold} guardians confirm`,
            run: async () => {
              for (const g of voters) if (!w.attestations.some((a) => a.guardian === g)) await attestDeceased(g, owner);
            },
            enabled: s === "GuardianVote",
            tone: "danger",
          }
        : undefined,
  });
  out.push({ label: "Challenge period", detail: "The owner is alerted on every channel. A sign of life now still cancels everything.", done: reached(w, "Executing") });
  out.push({
    label: scenario === "accelerated" ? "Releasing 10% → 30% → 60%" : "Releasing 10% → 20% → 30% → 40%",
    detail:
      scenario === "late-heir"
        ? `Once a slice or two has been released, open ${heir?.name ?? "the heir"}'s view and choose how to receive: the waiting slices then pay out together.`
        : "The longest wait comes right after the first 10%, because that's when a living owner would notice. NEAR moves for real, and so do Sepolia and Bitcoin if their vaults were funded.",
    done: reached(w, "SecretsBuffer"),
    link: scenario === "late-heir" && heir ? { label: `Open ${heir.name}'s view`, href: `/heir/${owner}?as=${heir.account_id}` } : undefined,
  });
  out.push({ label: "Waiting before secrets", detail: "One last wait: a sign of life here still stops the notes from ever being released.", done: reached(w, "SecretsReleased") });
  out.push({
    label: `As ${heir?.name ?? "the heir"}, open the sealed note`,
    detail: "Released only now, re-sealed to the heir's own key, and opened in the heir's browser.",
    done: s === "Completed",
    link: heir ? { label: `Open ${heir.name}'s view`, href: `/heir/${owner}?as=${heir.account_id}` } : undefined,
  });
  return out;
}

/** On a role page opened from the switcher: the way back to the owner's dashboard. */
export function BackToOwner({ owner }: { owner: string }) {
  useKeys();
  if (!canSign(owner)) return null;
  return (
    <Link href={`/owner?as=${owner}`} className="text-sm text-accent underline">
      ← Back to the owner&apos;s view
    </Link>
  );
}

/** "View as": every role in this will that this browser can sign for. */
export function RoleSwitcher({ will }: { will: Will }) {
  useKeys();
  const label = useAccountLabel();
  const o = will.owner;
  const roles: { label: string; href: string; account: string }[] = [
    ...will.guardians.map((g) => ({ label: `Guardian: ${label(g.account_id)}`, href: `/guardian/${o}?as=${g.account_id}`, account: g.account_id })),
    ...will.heirs.map((h) => ({ label: `Heir: ${h.name}`, href: `/heir/${o}?as=${h.account_id}`, account: h.account_id })),
    ...will.contacts.map((c) => ({ label: `Friend: ${label(c)}`, href: `/contact/${o}?as=${c}`, account: c })),
    ...(will.lawyer ? [{ label: `Lawyer: ${label(will.lawyer)}`, href: `/guardian/${o}?as=${will.lawyer}`, account: will.lawyer }] : []),
  ].filter((r) => keys.secret(r.account));
  if (!roles.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">View as:</span>
      <Pill tone="accent">Owner (here)</Pill>
      {roles.map((r) => (
        <Link key={r.href} href={r.href} className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:bg-accent-soft">
          {r.label}
        </Link>
      ))}
    </div>
  );
}

export function Speedrun({ will, refresh }: { will: Will; refresh: () => void }) {
  const [scenario, setScenario] = useStored<Scenario>(`inheirit:scenario:${will.owner}`, "returns");
  const [escalatedFlag, setEscalated] = useStored<"0" | "1">(`inheirit:escalated:${will.owner}`, "0");
  const [log, setLog] = useState<string[]>([]);
  const s = stateName(will.state);
  const demo = isSpeedrun(will);
  // Remember that this run left All good, so "came back" can be told apart from "never left"
  useEffect(() => {
    if (demo && s !== "Active" && escalatedFlag !== "1") setEscalated("1");
  }, [demo, s, escalatedFlag, setEscalated]);
  const escalated = escalatedFlag === "1";

  if (!demo) {
    return (
      <Card title="Set your will in motion" aside={<Pill>speedrun</Pill>}>
        <p className="text-sm text-muted">
          Watch your own will run from start to finish in about 15 minutes instead of months. This switches it to demo timings: it goes quiet
          after 2 minutes of silence, and slices go out minutes apart. It&apos;s testnet, so nothing is lost: switch back any time, or start over
          once it completes.
        </p>
        <ScenarioPicker value={scenario} onChange={setScenario} />
        <div className="mt-3">
          <ActionButton
            disabled={s !== "Active"}
            onClick={async () => {
              await setTimings(will, true);
              setEscalated("0");
              refresh();
            }}
          >
            Start the speedrun
          </ActionButton>
          {s !== "Active" && <p className="mt-1 text-xs text-muted">Timings can only change while the will is at All good.</p>}
        </div>
      </Card>
    );
  }

  const list = steps(will, scenario, escalated);
  const current = list.findIndex((x) => !x.done);
  return (
    <Card
      title="Set your will in motion"
      aside={
        <span className="flex gap-2">
          <Pill tone="warn">demo timings</Pill>
        </span>
      }
    >
      <ScenarioPicker value={scenario} onChange={(v) => (setScenario(v), setEscalated(s === "Active" ? "0" : "1"))} />
      <ol className="mt-4 space-y-2">
        {list.map((st, i) => (
          <li key={st.label} className={`rounded-lg border px-3 py-2 ${i === current ? "border-accent bg-accent-soft" : "border-line"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`text-sm ${st.done ? "text-muted line-through" : i === current ? "font-semibold" : ""}`}>
                {st.done ? "✓ " : `${i + 1}. `}
                {st.label}
              </span>
              <span className="flex flex-wrap gap-2">
                {st.action && !st.done && (
                  <ActionButton tone={st.action.tone ?? "primary"} disabled={!st.action.enabled} onClick={() => st.action!.run().then(refresh)}>
                    {st.action.label}
                  </ActionButton>
                )}
                {st.link && (
                  <Link href={st.link.href} className="text-xs text-accent underline">
                    {st.link.label}
                  </Link>
                )}
              </span>
            </div>
            {i === current && <p className="mt-1 text-xs text-muted">{st.detail}</p>}
          </li>
        ))}
      </ol>
      <div className="mt-4 space-y-3">
        <RoleSwitcher will={will} />
        <div className="flex flex-wrap gap-2">
          {s === "Active" && (
            <ActionButton tone="quiet" onClick={async () => (await setTimings(will, false), refresh())}>
              Back to real timings
            </ActionButton>
          )}
          {s === "Completed" && (
            <ActionButton
              onClick={async () => {
                setLog([]);
                await startOver(will, (m) => setLog((l) => [...l, m]));
                setEscalated("0");
                refresh();
              }}
            >
              Start over with the same people
            </ActionButton>
          )}
        </div>
        {log.length > 0 && (
          <ul className="font-mono text-xs text-muted">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ScenarioPicker({ value, onChange }: { value: Scenario; onChange: (s: Scenario) => void }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {SCENARIOS.map((sc) => (
        <label
          key={sc.id}
          className={`cursor-pointer rounded-lg border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${value === sc.id ? "border-accent bg-accent-soft" : "border-line hover:bg-accent-soft"}`}
        >
          <input type="radio" name="scenario" className="sr-only" checked={value === sc.id} onChange={() => onChange(sc.id)} />
          <span className="font-medium">{sc.title}</span>
          <span className="mt-0.5 block text-xs text-muted">{sc.blurb}</span>
        </label>
      ))}
    </div>
  );
}
