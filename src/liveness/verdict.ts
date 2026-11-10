// Plain-English liveness verdict (CLAUDE.md §7.8). Deterministic text, no LLM: why the owner counts
// as alive, which signals were ignored and why, and what the will's current state means. Built from
// timestamps only; never from content.
import { acceptedGuardians, isArmed, stateName, type WillView } from "../near/will-contract";
import { DEFAULT_SCORE_OPTIONS, type Observation, scoreAlive, type SignalSource } from "./score";

const NOUN: Record<SignalSource, string> = {
  near_onchain: "NEAR transaction",
  evm_onchain: "Sepolia transaction",
  phone_heartbeat: "heartbeat app ping",
  github: "GitHub activity",
  telegram: "Telegram reply",
  google_calendar: "Google Calendar event",
  gmail: "Gmail activity",
  x: "X post",
  instagram: "Instagram post",
  tiktok: "TikTok post",
  facebook: "Facebook post",
  whatsapp: "WhatsApp reply",
  linkedin: "LinkedIn activity",
};

const WHY_WEAK: Partial<Record<SignalSource, string>> = {
  x: "posts can be scheduled or run by someone else",
  instagram: "posts can be scheduled or run by someone else",
  tiktok: "posts can be scheduled or run by someone else",
  facebook: "posts can be scheduled or run by someone else",
  whatsapp: "a messaging account can be used by someone else",
  linkedin: "profiles can be managed by someone else",
  github: "activity can come from automation or collaborators",
};

export interface Verdict {
  /** One line for the hero panel. */
  headline: string;
  /** Supporting lines: ignored signals, what the state means. */
  details: string[];
  /** Signals that did not count, and why. */
  ignored: { source: SignalSource; reason: string }[];
}

/** "10 minutes ago", "3 hours ago", "2 days ago". */
export function since(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} seconds ago`;
  if (s < 90 * 60) return `${Math.round(s / 60)} minutes ago`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function label(o: Pick<Observation, "source" | "simulated">): string {
  return `${NOUN[o.source]}${o.simulated ? " (SIMULATED)" : ""}`;
}

export function explainLiveness(will: WillView, observations: Observation[], now: Date, opts = DEFAULT_SCORE_OPTIONS): Verdict {
  const nowMs = now.getTime();
  const best = scoreAlive(observations, now, opts);
  const details: string[] = [];
  const ignored: Verdict["ignored"] = [];
  const lastAliveMs = will.last_alive_at * 1000;

  // Signals newer than what counted, that didn't count on their own.
  for (const o of observations) {
    const t = o.at.getTime();
    if (t > nowMs + opts.maxFutureSkewMs) {
      ignored.push({ source: o.source, reason: "its time is in the future, so it can't be trusted" });
      continue;
    }
    if (o.trustWeight >= opts.strongWeight || best?.basis.includes(o.source)) continue;
    if (t <= lastAliveMs || (best && t <= best.at.getTime())) continue;
    const reason = `ignored on its own because ${WHY_WEAK[o.source] ?? "it is easy to fake"}; it counts only if another independent source agrees within 24 hours`;
    ignored.push({ source: o.source, reason });
  }
  for (const i of ignored) {
    const o = observations.find((x) => x.source === i.source)!;
    details.push(`One ${label(o)} seen ${since(nowMs - o.at.getTime())}; ${i.reason}.`);
  }

  const lastSeen = () => {
    if (!best) return will.last_alive_at ? `Last counted sign of life: ${since(nowMs - lastAliveMs)}.` : "No sign of life counted yet.";
    const obs = best.basis.map((s) => observations.find((o) => o.source === s)!);
    return best.basis.length === 1
      ? `Last strong signal: ${label(obs[0])} ${since(nowMs - best.at.getTime())}.`
      : `Two independent signals agree: ${obs.map(label).join(" and ")}, ${since(nowMs - best.at.getTime())}.`;
  };
  const quietFor = since(nowMs - lastAliveMs).replace(" ago", "");

  const state = stateName(will.state);
  let headline: string;
  switch (state) {
    case "Active":
      // Active but already past quiet_after (e.g. a guardian vote just expired): not a sign of life.
      headline =
        isArmed(will) && nowMs - lastAliveMs >= will.timings.quiet_after * 1000
          ? `No sign of life for ${quietFor}; the checks start again shortly. ${lastSeen()}`
          : `Alive. ${lastSeen()}`;
      if (!isArmed(will)) {
        details.push(
          `Not armed: ${acceptedGuardians(will).length} of ${will.guardian_threshold} required guardians have accepted, so nothing can start, however long the silence.`,
        );
      }
      break;
    case "Quiet":
      headline = `Quiet for ${quietFor}. Checks started: heartbeat app, email, Telegram, then DMs. Any reply stops it.`;
      details.push(lastSeen());
      break;
    case "WelfareCheck":
      const asked = ["guardians", ...(will.contacts.length ? ["friends"] : []), ...(will.lawyer ? ["the lawyer"] : [])];
      const who = asked.length > 1 ? `${asked.slice(0, -1).join(", ")} and ${asked[asked.length - 1]}` : asked[0];
      headline = `Quiet for ${quietFor} and no reply to the checks. ${who[0].toUpperCase()}${who.slice(1)} are asked whether they've heard from ${will.owner}.`;
      break;
    case "GuardianVote":
      headline = `Quiet for ${quietFor}. Guardians are asked to confirm, with evidence. One "alive" stops it.`;
      break;
    case "Challenge":
      headline = `Guardians confirmed. Challenge period: ${will.owner} is told on every channel, and any sign of life cancels everything.`;
      break;
    case "Executing": {
      const s = typeof will.state !== "string" && "Executing" in will.state ? will.state.Executing.stage : 0;
      headline = `Releasing stage ${s + 1} of ${will.round_stages.length}${will.accelerated ? " (accelerated after a death proof)" : ""}. Any sign of life halts the rest.`;
      break;
    }
    case "SecretsBuffer":
      headline = "Everything is distributed. Sealed notes wait out a final buffer; a sign of life still stops them.";
      break;
    case "SecretsReleased":
      headline = "Sealed notes are being released to each heir.";
      break;
    default:
      headline = "The will has been carried out.";
  }
  return { headline, details, ignored };
}
