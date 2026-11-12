// Real email for checks and alerts (CLAUDE.md §7.3), through Resend's HTTP API. Off unless
// RESEND_API_KEY and NOTIFY_FROM_EMAIL are set; without them the app shows email checks in its log only.
// Privacy: the agent never logs a message's content or the address it went to; the app's notification
// log records the channel and the time (addresses are masked in public routes).
import { RateLimiter } from "../auth/rate-limit";

export type SendResult = "sent" | "capped" | "invalid";

export interface Mailer {
  /**
   * Sends one plain-text email. "capped" when a daily limit stopped it (the app shows the message instead).
   * `demo` marks a will on demo timings: those draw from a smaller budget, so real wills always have room.
   * Throws on a provider error, with no address or content in the message.
   */
  send(to: string, subject: string, text: string, opts?: { demo?: boolean }): Promise<SendResult>;
}

const DAY = 24 * 3_600_000;
/** Anyone can name an address in a throwaway will, so each address gets at most this many a day. */
export const EMAIL_PER_ADDRESS_PER_DAY = 12;
/** The whole agent at most this many a day (Resend's free tier is 100/day; raise with the plan). */
export const EMAIL_GLOBAL_PER_DAY = 95;
/** Of which demo-timing wills (speedruns) may use at most this many: real-timing wills get priority. */
export const EMAIL_DEMO_PER_DAY = 60;
/** Every email says how to answer, because nobody reads replies. */
export const EMAIL_FOOTER = "Open your heartbeat app or reply on Telegram; replies to this email aren't read.";

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export class ResendMailer implements Mailer {
  private readonly caps: RateLimiter;
  private readonly demoCaps: RateLimiter;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    this.caps = new RateLimiter({ perKey: EMAIL_PER_ADDRESS_PER_DAY, global: EMAIL_GLOBAL_PER_DAY, windowMs: DAY }, now);
    this.demoCaps = new RateLimiter({ perKey: EMAIL_PER_ADDRESS_PER_DAY, global: EMAIL_DEMO_PER_DAY, windowMs: DAY }, now);
  }

  async send(to: string, subject: string, text: string, opts: { demo?: boolean } = {}): Promise<SendResult> {
    if (!isEmail(to)) return "invalid";
    const key = to.toLowerCase();
    if (opts.demo && this.demoCaps.take(key)) return "capped";
    if (this.caps.take(key)) {
      if (opts.demo) this.demoCaps.refund(key);
      return "capped";
    }
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [to], subject, text }),
    });
    // Only the status leaves this function: no address, no content, no key.
    if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    return "sent";
  }
}

/** The mailer from env, or undefined when email isn't configured. */
export function mailerFromEnv(): Mailer | undefined {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  return key && from ? new ResendMailer(key, from) : undefined;
}
