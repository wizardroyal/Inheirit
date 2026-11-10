// Escalation driver (CLAUDE.md §7.3). Each tick, for every watched owner:
//  1. score liveness from the signal adapters and report a newer "alive" time on-chain;
//  2. call advance() when the current period has elapsed (one step per tick);
//  3. notify the right people when the will enters a new state;
//  4. hand Executing wills to the executor (on its own queue, so signing never blocks other wills);
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
import type { OwnerSignalConfig, Store } from "../state/store";
import { CHECK_TEXT, type TelegramBot } from "../telegram/bot";

/** Seconds of margin so a reported time is never ahead of the chain's block time. */
const CHAIN_CLOCK_MARGIN_S = 5;

export interface Executor {
  run(owner: string, will: WillView): Promise<void>;
  /** Owner withdrawals from foreign vaults, while Active. */
  withdraw?(owner: string, will: WillView): Promise<void>;
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
  /** Telegram check bot; absent when not configured. */
  telegram?: Pick<TelegramBot, "notify" | "isLinked">;
  /** Onward payouts through NEAR Intents (SIMULATED 1Click on testnet). */
  payouts?: { run(will: WillView): Promise<void> };
  now?: () => Date;
  log?: (msg: string) => void;
  /**
   * Demo mode: stop driving a speedrun will (demo timings) this long after the agent started watching it,
   * unless it is mid-execution. Abandoned demo wills would otherwise cycle (a failed vote returns them to
   * Active) forever, costing gas and RPC calls. Wills with real timings are always watched. Unset in real mode.
   */
  demoWatchMs?: number;
  /** Owners ticked at once (default 4). Each owner's own steps stay in order. */
  concurrency?: number;
  /** Executions and withdrawals in flight at once (default 2): MPC signing is slow, so it runs on its own
   *  queue and never holds up liveness checks or a snap-back for other wills. */
  executionConcurrency?: number;
}

/** A will with compressed (demo) timings: a speedrun (§13A.1). Real wills go quiet after days, not minutes. */
export function isSpeedrun(will: WillView): boolean {
  return will.timings.quiet_after < 3600;
}

/** Runs keyed tasks with a concurrency limit; a key already queued or running is not added twice. */
export class KeyedQueue {
  private active = 0;
  private readonly keys = new Set<string>();
  private readonly waiting: { key: string; run: () => Promise<void> }[] = [];
  private idleWaiters: (() => void)[] = [];
  constructor(
    private readonly limit: number,
    private readonly onError: (key: string, e: unknown) => void,
  ) {}

  add(key: string, run: () => Promise<void>): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.waiting.push({ key, run });
    this.pump();
    return true;
  }

  /** Resolves once nothing is queued or running. */
  idle(): Promise<void> {
    return this.active === 0 && this.waiting.length === 0 ? Promise.resolve() : new Promise((r) => this.idleWaiters.push(r));
  }

  private pump() {
    while (this.active < this.limit && this.waiting.length) {
      const { key, run } = this.waiting.shift()!;
      this.active++;
      run()
        .catch((e) => this.onError(key, e))
        .finally(() => {
          this.active--;
          this.keys.delete(key);
          this.pump();
          if (this.active === 0 && this.waiting.length === 0) {
            for (const w of this.idleWaiters.splice(0)) w();
          }
        });
    }
  }
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

/** A message for one event; the driver records it once and delivers it on every channel it can. */
export interface Message {
  event: string;
  to: string[];
  subject: string;
  body: string;
}

/** Who to tell, and what, when a will enters `state` (§7.3). Quiet is handled by the checks. */
export function notificationsFor(state: StateName, will: WillView, cfg: OwnerSignalConfig, contacts: string[]): Message[] {
  const owner = will.owner;
  const toOwner = [owner, ...(cfg.email ? [cfg.email] : [])];
  const msg = (to: string[], subject: string, body: string): Message[] => (to.length ? [{ event: state, to, subject, body }] : []);
  switch (state) {
    case "WelfareCheck":
      // The welfare chain: guardians, then friends, then the lawyer.
      return msg(
        [...acceptedGuardians(will), ...contacts, ...(will.lawyer ? [will.lawyer] : [])],
        `Have you heard from ${owner} recently?`,
        `If they're fine, confirm it here: /contact/${owner}`,
      );
    case "GuardianVote":
      return msg(
        acceptedGuardians(will),
        `Guardian vote for ${owner}`,
        `${owner} has been silent and didn't answer a welfare check. Attest only with evidence: /guardian/${owner}`,
      );
    case "Challenge": {
      const hours = Math.round(will.timings.challenge_period / 3600);
      return msg(
        toOwner,
        "Your will executes soon",
        `Guardians attested. Your will starts executing in ${hours >= 1 ? `${hours} h` : `${will.timings.challenge_period} s`}. Any activity cancels it.`,
      );
    }
    case "Executing":
      return msg(
        will.heirs.map((h) => h.account_id),
        `${owner}'s will is being executed`,
        `Assets are being released to you in stages. Your claim page: /heir/${owner}`,
      );
    case "SecretsReleased":
      return msg(
        will.heirs.map((h) => h.account_id),
        `Sealed notes from ${owner} are ready`,
        `Distribution is complete. Notes left for you can now be opened on your claim page: /heir/${owner}`,
      );
    default:
      return [];
  }
}

/** Events whose Telegram message goes out every time, even during the same silence. */
const REPEATABLE_ON_TELEGRAM = new Set(["Challenge", "Executing", "SecretsReleased"]);

/** Outreach while Quiet, in this order, spaced evenly across nudge_period (§7.3). */
export const CHECK_STEPS = ["heartbeat", "email", "telegram", "dm"] as const;

export class Driver {
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;
  private readonly execution: KeyedQueue;
  /** Per-owner chain: a poke and the loop's tick never run the same will at once. */
  private readonly ownerRuns = new Map<string, Promise<void>>();
  constructor(private readonly deps: DriverDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((m) => console.log(m));
    this.execution = new KeyedQueue(deps.executionConcurrency ?? 2, (key, e) =>
      this.log(`[executor] ${key}: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  async tick(): Promise<void> {
    const owners = Object.values(this.deps.store.get().owners);
    let throttled = false;
    let next = 0;
    const worker = async () => {
      while (!throttled && next < owners.length) {
        const cfg = owners[next++];
        try {
          if (await this.expireDemoWill(cfg)) continue;
          await this.serial(cfg.owner, () => this.tickOwner(cfg));
        } catch (e) {
          this.log(`[driver] ${cfg.owner}: ${e instanceof Error ? e.message : String(e)}`);
          if (isRateLimited(e) && !throttled) {
            throttled = true;
            this.log("[driver] NEAR RPC is rate-limiting; skipping the rest of this tick");
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.deps.concurrency ?? 4, owners.length) }, worker));
  }

  /**
   * A sign of life just arrived for `owner` (heartbeat, Telegram reply, demo signal): tick that will now
   * instead of at the next loop, so the snap-back doesn't wait up to a whole tick interval.
   */
  poke(owner: string): Promise<void> {
    const cfg = this.deps.store.get().owners[owner];
    if (!cfg) return Promise.resolve();
    return this.serial(owner, () => this.tickOwner(cfg)).catch((e) =>
      this.log(`[driver] ${owner}: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  private serial(owner: string, run: () => Promise<void>): Promise<void> {
    const next = (this.ownerRuns.get(owner) ?? Promise.resolve()).then(run);
    // The chain itself never rejects (the caller gets `next` and handles its error); otherwise a failed
    // run would surface as an unhandled rejection.
    const tracked: Promise<void> = next
      .catch(() => {})
      .finally(() => {
        if (this.ownerRuns.get(owner) === tracked) this.ownerRuns.delete(owner);
      });
    this.ownerRuns.set(owner, tracked);
    return next;
  }

  /** Resolves once queued executions and withdrawals have finished (tests, shutdown). */
  idle(): Promise<void> {
    return this.execution.idle();
  }

  /** Demo mode: drops a will from the watch list once its time is up (never mid-execution). */
  private async expireDemoWill(cfg: OwnerSignalConfig): Promise<boolean> {
    const ttl = this.deps.demoWatchMs;
    if (!ttl || !cfg.watchedSince) return false;
    if (this.now().getTime() - Date.parse(cfg.watchedSince) < ttl) return false;
    const will = await this.deps.contract.getWill(cfg.owner);
    if (will && !isSpeedrun(will)) return false;
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
      store.update((s) => (s.notifiedState[cfg.owner] = state));
      for (const m of notificationsFor(state, will, cfg, contacts)) await this.deliver(cfg.owner, m, will.last_alive_at);
    }
    if (typeof will.state !== "string" && "Quiet" in will.state) await this.runChecks(cfg, will, will.state.Quiet.since, nowS);

    // Queued, not awaited: a slow MPC signature must not delay this tick for other wills. One entry per
    // owner, so a run still in flight is not started twice; the next tick picks up whatever is left.
    // A queued task re-reads the will when it starts, so it never acts on a snapshot older than the
    // previous run's records (the executor's idempotency checks read them).
    const executor = this.deps.executor;
    if (state === "Executing" && executor) {
      this.execution.add(cfg.owner, async () => {
        const fresh = await contract.getWill(cfg.owner);
        if (fresh && stateName(fresh.state) === "Executing") await executor.run(cfg.owner, fresh);
      });
    }
    if (state === "Active" && will.pending_withdrawals.some((w) => w.chain !== "Near") && executor?.withdraw) {
      const withdraw = executor.withdraw.bind(executor);
      this.execution.add(cfg.owner, async () => {
        const fresh = await contract.getWill(cfg.owner);
        if (fresh && stateName(fresh.state) === "Active") await withdraw(cfg.owner, fresh);
      });
    }
    // Secrets last: only once distribution and the buffer are over (the contract enforces it too).
    if (state === "SecretsReleased" && this.deps.notes) await this.deps.notes.run(will);
    // Onward payouts over NEAR Intents (§J.3) for every slice released so far, including after a halt.
    if (will.executions.length && this.deps.payouts) {
      try {
        await this.deps.payouts.run(will);
      } catch (e) {
        this.log(`[payout] ${cfg.owner}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * Whether this Telegram message is new for the current silence, and marks it sent. Repeats of the
   * check and welfare/vote messages after an expired vote (same last_alive_at) stay in the app only.
   * The challenge alarm and heir notices are always sent.
   */
  private firstTelegramThisSilence(owner: string, event: string, lastAliveAt: number): boolean {
    if (!REPEATABLE_ON_TELEGRAM.has(event)) {
      const prev = this.deps.store.get().telegramSent[owner];
      const events = prev?.lastAliveAt === lastAliveAt ? prev.events : [];
      if (events.includes(event)) return false;
      this.deps.store.update((s) => (s.telegramSent[owner] = { lastAliveAt, events: [...events, event] }));
    }
    return true;
  }

  /** Records one notification and sends it on Telegram to every recipient with a linked chat. */
  private async deliver(owner: string, m: Message, lastAliveAt: number, channels: string[] = ["ui"]): Promise<void> {
    const out = [...channels];
    if (this.deps.telegram && m.to.some((a) => this.deps.telegram!.isLinked(a)) && !this.firstTelegramThisSilence(owner, m.event, lastAliveAt)) {
      out.push("telegram (already sent during this silence)");
    } else if (this.deps.telegram) {
      let sent = 0;
      for (const to of m.to) {
        try {
          if (await this.deps.telegram.notify(to, `${m.subject}\n\n${m.body}`)) sent++;
        } catch (e) {
          this.log(`[telegram] ${owner}: message to ${to} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (sent) out.push("telegram");
    }
    this.record(owner, m, out);
  }

  private record(owner: string, m: Message, channels: string[]) {
    const at = this.now().toISOString();
    this.deps.store.update((s) => {
      s.notifications.push({ at, owner, ...m, channels });
      s.notifications = s.notifications.slice(-500);
    });
  }

  /** Sends the Quiet checks that are due: step i at since + i/4 of the nudge period. */
  private async runChecks(cfg: OwnerSignalConfig, will: WillView, since: number, nowS: number): Promise<void> {
    const owner = cfg.owner;
    const nudgePeriod = will.timings.nudge_period;
    const prev = this.deps.store.get().checks[owner];
    const done = prev?.since === since ? [...prev.done] : [];
    for (const [i, step] of CHECK_STEPS.entries()) {
      if (done.includes(step) || nowS < since + Math.floor((i * nudgePeriod) / CHECK_STEPS.length)) continue;
      done.push(step);
      this.deps.store.update((s) => (s.checks[owner] = { since, done: [...done] }));
      const check = (subject: string, body = CHECK_TEXT): Message => ({ event: "check", to: [owner], subject, body });
      if (step === "heartbeat") this.record(owner, check("Check: heartbeat app"), ["ui", "heartbeat app"]);
      else if (step === "email" && cfg.email)
        this.record(owner, { ...check("Check: email"), to: [cfg.email], body: `${CHECK_TEXT} (Email delivery isn't set up in this build; shown in the app instead.)` }, ["ui"]);
      else if (step === "telegram" && this.deps.telegram?.isLinked(owner)) {
        if (!this.firstTelegramThisSilence(owner, "check", will.last_alive_at)) {
          this.record(owner, check("Check: Telegram (not resent: already asked during this silence)"), ["ui"]);
          continue;
        }
        try {
          await this.deps.telegram.notify(owner, CHECK_TEXT);
          this.record(owner, check("Check: Telegram"), ["telegram"]);
        } catch (e) {
          this.log(`[telegram] ${owner}: check failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (step === "dm") this.record(owner, check("Check: DM (SIMULATED)"), ["dm (SIMULATED)"]);
    }
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
