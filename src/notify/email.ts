// Real email for checks and alerts (CLAUDE.md §7.3), through Resend's HTTP API. Off unless
// RESEND_API_KEY and NOTIFY_FROM_EMAIL are set; without them the app shows email checks in its log only.
// Privacy: the agent never logs a message's content or the address it went to; the app's notification
// log records the channel and the time (addresses are masked in public routes).
import { RateLimiter } from "../auth/rate-limit";

export interface Mailer {
  /** Sends one plain-text email; false when a cap stopped it. Throws on a provider error (no content in the message). */
  send(to: string, subject: string, text: string): Promise<boolean>;
}

const DAY = 24 * 3_600_000;
/** Anyone can name an address in a throwaway will, so each address gets at most this many a day. */
export const EMAIL_PER_ADDRESS_PER_DAY = 12;
/** And the whole agent at most this many a day (Resend's free tier is 100/day; raise with the plan). */
export const EMAIL_GLOBAL_PER_DAY = 90;

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export class ResendMailer implements Mailer {
  private readonly caps: RateLimiter;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    this.caps = new RateLimiter({ perKey: EMAIL_PER_ADDRESS_PER_DAY, global: EMAIL_GLOBAL_PER_DAY, windowMs: DAY }, now);
  }

  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!isEmail(to)) return false;
    if (this.caps.take(to.toLowerCase())) return false;
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [to], subject, text }),
    });
    // Only the status leaves this function: no address, no content, no key.
    if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    return true;
  }
}

/** The mailer from env, or undefined when email isn't configured. */
export function mailerFromEnv(): Mailer | undefined {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  return key && from ? new ResendMailer(key, from) : undefined;
}
