// Escalation driver (CLAUDE.md §7.3). Each tick, for every watched owner:
//  1. score liveness from the signal adapters and report a newer "alive" time on-chain;
//  2. call advance() when the current period has elapsed (one step per tick);
//  3. notify the right people when the will enters a new state;
//  4. hand Executing wills to the executor;
//  5. release sealed notes to heirs once execution has started.
import { type Observation, scoreAlive } from "../liveness/score";
import { stateName, type StateName, type WillContract, type WillView } from "../near/will-contract";
import type { SignalAdapter } from "../signals/adapters";
import type { Notification, OwnerSignalConfig, Store } from "../state/store";

/** Seconds of margin so a reported time is never ahead of the chain's block time. */
const CHAIN_CLOCK_MARGIN_S = 5;

export interface Executor {
  run(owner: string, will: WillView): Promise<void>;
}

export interface NoteReleaser {
  run(will: WillView): Promise<number>;
}

export interface DriverDeps {
  contract: WillContract;
  adapters: SignalAdapter[];
  store: Store;
  executor?: Executor;
  notes?: NoteReleaser;
  now?: () => Date;
  log?: (msg: string) => void;
}

/** Whether advance() would change the state at `nowS` (mirrors the contract's internal_advance). */
export function isAdvanceDue(will: WillView, nowS: number): boolean {
  const t = will.timings;
  const s = will.state;
  const elapsed = (since: number) => nowS - since;
  if (s === "Active") return elapsed(will.last_alive_at) >= t.quiet_after;
  if ("Quiet" in s) return elapsed(s.Quiet.since) >= t.nudge_period;
  if ("WelfareCheck" in s) return elapsed(s.WelfareCheck.since) >= t.welfare_period;
  if ("GuardianVote" in s) return elapsed(s.GuardianVote.since) >= t.vote_period;
  if ("Challenge" in s) return elapsed(s.Challenge.since) >= t.challenge_period;
  if ("Executing" in s) {
    if (elapsed(s.Executing.stage_started) < t.stage_interval) return false;
    const last = will.stages_pct.length - 1;
    if (s.Executing.stage < last) return true;
    return will.foreign_chains.every((c) =>
      Array.from({ length: last + 1 }, (_, i) => i).every((st) => will.stage_done.some((d) => d.stage === st && d.chain === c)),
    );
  }
  return false;
}

/** Who to tell, and what, when a will enters `state` (§7.3). */
export function notificationsFor(state: StateName, will: WillView, cfg: OwnerSignalConfig, contacts: string[]): Omit<Notification, "at">[] {
  const owner = will.owner;
  const ownerChannels = [`${owner} (wallet)`, ...(cfg.email ? [cfg.email] : []), `${owner} (heartbeat app)`];
  const toOwner = (subject: string, body: string) =>
    ownerChannels.map((to) => ({ owner, to, channel: "ui" as const, subject, body }));
  switch (state) {
    case "Quiet":
      return toOwner("Are you there?", "We haven't seen activity from you for a while. Open the heartbeat app or sign any transaction and nothing else happens.");
    case "WelfareCheck":
      return contacts.map((to) => ({
        owner,
        to,
        channel: "ui" as const,
        subject: `Have you heard from ${owner} recently?`,
        body: `If they're fine, confirm it here: /contact/${owner}`,
      }));
    case "GuardianVote":
      return will.guardians.map((to) => ({
        owner,
        to,
        channel: "ui" as const,
        subject: `Guardian vote for ${owner}`,
        body: `${owner} has been silent and didn't answer a welfare check. Attest only with evidence: /guardian/${owner}`,
      }));
    case "Challenge": {
      const hours = Math.round(will.timings.challenge_period / 3600);
      return toOwner(
        "Your will executes soon",
        `Guardians attested. Your will starts executing in ${hours >= 1 ? `${hours} h` : `${will.timings.challenge_period} s`}. Any activity cancels it.`,
      );
    }
    case "Executing":
      return will.heirs.map((h) => ({
        owner,
        to: h.account_id,
        channel: "ui" as const,
        subject: `${owner}'s will is being executed`,
        body: `Assets are being released to you in stages. Your claim page: /heir/${owner}`,
      }));
    default:
      return [];
  }
}

export class Driver {
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;
  constructor(private readonly deps: DriverDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((m) => console.log(m));
  }

  async tick(): Promise<void> {
    for (const cfg of Object.values(this.deps.store.get().owners)) {
      try {
        await this.tickOwner(cfg);
      } catch (e) {
        this.log(`[driver] ${cfg.owner}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async tickOwner(cfg: OwnerSignalConfig): Promise<void> {
    const { contract, store } = this.deps;
    let will = await contract.getWill(cfg.owner);
    if (!will) return;
    const nowS = Math.floor(this.now().getTime() / 1000);

    if (stateName(will.state) !== "Completed") {
      const verdict = scoreAlive(await this.observe(cfg), this.now());
      if (verdict) {
        const atS = Math.min(Math.floor(verdict.at.getTime() / 1000), nowS - CHAIN_CLOCK_MARGIN_S);
        if (atS > will.last_alive_at) {
          await contract.recordLiveness(cfg.owner, atS);
          this.log(`[driver] ${cfg.owner}: alive at ${new Date(atS * 1000).toISOString()} (${verdict.basis.join("+")})`);
          will = (await contract.getWill(cfg.owner))!;
        }
      }
      if (isAdvanceDue(will, nowS) && (await contract.advance(cfg.owner))) {
        will = (await contract.getWill(cfg.owner))!;
        this.log(`[driver] ${cfg.owner}: advanced to ${stateName(will.state)}`);
      }
    }

    const state = stateName(will.state);
    if (store.get().notifiedState[cfg.owner] !== state) {
      const contacts = store.get().policies[cfg.owner]?.contacts ?? [];
      const at = this.now().toISOString();
      const sent = notificationsFor(state, will, cfg, contacts).map((n) => ({ ...n, at }));
      store.update((s) => {
        s.notifiedState[cfg.owner] = state;
        s.notifications.push(...sent);
        s.notifications = s.notifications.slice(-500);
      });
    }

    if (state === "Executing" && this.deps.executor) await this.deps.executor.run(cfg.owner, will);
    // After the executor, so a failing note can't hold up money; Completed too, for heirs who register late.
    if ((state === "Executing" || state === "Completed") && this.deps.notes) await this.deps.notes.run(will);
  }

  private async observe(cfg: OwnerSignalConfig): Promise<Observation[]> {
    const out: Observation[] = [];
    for (const a of this.deps.adapters) {
      try {
        const at = await a.lastActivity(cfg);
        if (at) out.push({ source: a.source, at, trustWeight: a.trustWeight, simulated: a.simulated });
      } catch (e) {
        // A failing source is reported, never treated as silence or as activity.
        this.log(`[signals] ${a.source} for ${cfg.owner} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Merge, so a source that failed this tick keeps its last known time in the UI
    this.deps.store.update((s) => {
      const seen = (s.observations[cfg.owner] ??= {});
      for (const o of out) seen[o.source] = { at: o.at.toISOString(), trustWeight: o.trustWeight, simulated: o.simulated };
    });
    return out;
  }
}
