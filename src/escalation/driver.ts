// Escalation driver (CLAUDE.md §7.3). Each tick, for every watched owner:
//  1. score liveness from the signal adapters and report a newer "alive" time on-chain;
//  2. call advance() when the current period has elapsed (one step per tick);
//  3. notify the right people when the will enters a new state;
//  4. hand Executing wills to the executor;
//  5. release sealed notes to heirs once the will reaches SecretsReleased (secrets last, §5.5).
import { type Observation, scoreAlive } from "../liveness/score";
import {
  acceptedGuardians,
  executionStarted,
  isArmed,
  stateName,
  type StateName,
  type WillContract,
  type WillView,
} from "../near/will-contract";
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
  /**
   * Demo mode: stop driving a will this long after the agent started watching it, unless it is mid-
   * execution. Abandoned demo wills would otherwise cycle (a failed vote returns them to Active) forever,
   * costing gas and RPC calls. Unset in real mode.
   */
  demoWatchMs?: number;
}

/** True for errors that mean the RPC is throttling us; the rest of the tick waits for the next one. */
export function isRateLimited(e: unknown): boolean {
  return /\b429\b|rate limit/i.test(e instanceof Error ? e.message : String(e));
}

/** Whether advance() would change the state at `nowS` (mirrors the contract's internal_advance). */
export function isAdvanceDue(will: WillView, nowS: number): boolean {
  const t = will.timings;
  const s = will.state;
  const elapsed = (since: number) => nowS - since;
  if (s === "Active") return isArmed(will) && elapsed(will.last_alive_at) >= t.quiet_after;
  if ("Quiet" in s) return elapsed(s.Quiet.since) >= t.nudge_period;
  if ("WelfareCheck" in s) return elapsed(s.WelfareCheck.since) >= t.welfare_period;
  if ("GuardianVote" in s) return elapsed(s.GuardianVote.since) >= t.vote_period;
  if ("Challenge" in s) return elapsed(s.Challenge.since) >= t.challenge_period;
  if ("Executing" in s) {
    const stage = s.Executing.stage;
    if (elapsed(s.Executing.stage_started) < will.round_stages[stage].wait_after) return false;
    const last = will.round_stages.length - 1;
    if (stage < last) return true;
    return will.foreign_chains.every((c) =>
      Array.from({ length: last + 1 }, (_, i) => i).every((st) => will.stage_done.some((d) => d.stage === st && d.chain === c)),
    );
  }
  if ("SecretsBuffer" in s) return elapsed(s.SecretsBuffer.since) >= t.secrets_buffer;
  if ("SecretsReleased" in s) return will.sealed_notes.every((n) => will.released_notes.some((r) => r.note_id === n.id));
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
      // The welfare chain: guardians, then friends, then the lawyer.
      return [...acceptedGuardians(will), ...contacts, ...(will.lawyer ? [will.lawyer] : [])].map((to) => ({
        owner,
        to,
        channel: "ui" as const,
        subject: `Have you heard from ${owner} recently?`,
        body: `If they're fine, confirm it here: /contact/${owner}`,
      }));
    case "GuardianVote":
      return acceptedGuardians(will).map((to) => ({
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
    case "SecretsReleased":
      return will.heirs.map((h) => ({
        owner,
        to: h.account_id,
        channel: "ui" as const,
        subject: `Sealed notes from ${owner} are ready`,
        body: `Distribution is complete. Notes left for you can now be opened on your claim page: /heir/${owner}`,
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
        if (await this.expireDemoWill(cfg)) continue;
        await this.tickOwner(cfg);
      } catch (e) {
        this.log(`[driver] ${cfg.owner}: ${e instanceof Error ? e.message : String(e)}`);
        if (isRateLimited(e)) {
          this.log("[driver] NEAR RPC is rate-limiting; skipping the rest of this tick");
          return;
        }
      }
    }
  }

  /** Demo mode: drops a will from the watch list once its time is up (never mid-execution). */
  private async expireDemoWill(cfg: OwnerSignalConfig): Promise<boolean> {
    const ttl = this.deps.demoWatchMs;
    if (!ttl || !cfg.watchedSince) return false;
    if (this.now().getTime() - Date.parse(cfg.watchedSince) < ttl) return false;
    const will = await this.deps.contract.getWill(cfg.owner);
    if (will && executionStarted(will.state) && stateName(will.state) !== "Completed") return false;
    this.deps.store.update((s) => {
      delete s.owners[cfg.owner];
    });
    this.log(`[driver] ${cfg.owner}: demo will no longer watched (older than ${Math.round(ttl / 3_600_000)} h)`);
    return true;
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
    // Secrets last: only once distribution and the buffer are over (the contract enforces it too).
    if (state === "SecretsReleased" && this.deps.notes) await this.deps.notes.run(will);
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
