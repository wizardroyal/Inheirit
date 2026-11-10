// Telegram check channel (CLAUDE.md §7.7). The bot only sends check messages and listens for replies.
// - Linking: a NEAR account (owner, guardian or friend) gets a one-time t.me/<bot>?start=<token> link
//   from an owner-signed request; the chat that opens it is bound to that account.
// - Long polling (getUpdates): outbound calls only, which fits a TEE without an inbound URL.
// - Privacy: a reply's text is never stored or logged. Only its receive time is kept, and only for
//   chats linked to an account.
import { randomBytes } from "node:crypto";
import type { Store } from "../state/store";

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number; type?: string }; text?: string };
}

export interface TelegramApi {
  getUpdates(offset: number, timeoutS: number): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, text: string): Promise<void>;
}

/** Bot API over HTTPS. The token is part of every URL, so it is scrubbed from every error. */
export class HttpTelegramApi implements TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, body: unknown, timeoutMs: number): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(`telegram ${method}: ${String(e).replaceAll(this.token, "<token>")}`);
    }
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !json.ok) throw new Error(`telegram ${method}: ${res.status} ${json.description ?? ""}`.trim());
    return json.result as T;
  }

  getUpdates(offset: number, timeoutS: number) {
    return this.call<TelegramUpdate[]>("getUpdates", { offset, timeout: timeoutS, allowed_updates: ["message"] }, (timeoutS + 10) * 1000);
  }

  async sendMessage(chatId: number, text: string) {
    await this.call("sendMessage", { chat_id: chatId, text }, 15_000);
  }
}

const LINK_TTL_MS = 15 * 60_000;

export const CHECK_TEXT = "We haven't seen activity from you for a while. Reply anything (or open the heartbeat app) and nothing else happens.";

export class TelegramBot {
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;
  private readonly onReply?: (accounts: string[]) => void;
  constructor(
    private readonly api: TelegramApi,
    private readonly store: Store,
    readonly username: string,
    opts: { now?: () => Date; log?: (msg: string) => void; onReply?: (accounts: string[]) => void } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? ((m) => console.log(m));
    this.onReply = opts.onReply;
  }

  /** A one-time deep link that binds the chat that opens it to `account`. */
  issueLink(account: string): { url: string; expires_at: string } {
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + LINK_TTL_MS).toISOString();
    const nowMs = this.now().getTime();
    this.store.update((s) => {
      for (const [t, l] of Object.entries(s.telegramLinks)) if (Date.parse(l.expiresAt) < nowMs) delete s.telegramLinks[t];
      s.telegramLinks[token] = { account, expiresAt };
    });
    return { url: `https://t.me/${this.username}?start=${token}`, expires_at: expiresAt };
  }

  isLinked(account: string): boolean {
    return Boolean(this.store.get().telegramChats[account]);
  }

  /** Sends `text` to the account's linked chat. Returns false if it has none. */
  async notify(account: string, text: string): Promise<boolean> {
    const chat = this.store.get().telegramChats[account];
    if (!chat) return false;
    await this.api.sendMessage(chat.chatId, text);
    return true;
  }

  async handle(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    const text = msg.text ?? "";
    // Only one-to-one chats: in a group, any member's message would count as the owner's sign of life.
    if (msg.chat.type && msg.chat.type !== "private") {
      if (/^\/start\b/.test(text)) await this.api.sendMessage(chatId, "Please link from a private chat with me, not a group.");
      return;
    }
    const accounts = Object.entries(this.store.get().telegramChats)
      .filter(([, c]) => c.chatId === chatId)
      .map(([a]) => a);

    const start = /^\/start(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/.exec(text);
    if (start) {
      const link = start[1] ? this.store.get().telegramLinks[start[1]] : undefined;
      if (!link || Date.parse(link.expiresAt) < this.now().getTime()) {
        await this.api.sendMessage(chatId, "This link is not valid any more. Open Inheirit and choose \"Link Telegram\" again.");
        return;
      }
      const linkedAt = this.now().toISOString();
      this.store.update((s) => {
        delete s.telegramLinks[start[1]];
        s.telegramChats[link.account] = { chatId, linkedAt };
      });
      this.log(`[telegram] linked for ${link.account}`);
      await this.api.sendMessage(
        chatId,
        `Linked to ${link.account}. If you go quiet for longer than usual, I'll message you here; any reply means you're fine and nothing else happens.`,
      );
      return;
    }
    if (/^\/unlink\s*$/.test(text)) {
      this.store.update((s) => {
        for (const a of accounts) delete s.telegramChats[a];
      });
      await this.api.sendMessage(chatId, "Unlinked. You won't get messages here any more.");
      return;
    }
    if (!accounts.length) {
      await this.api.sendMessage(chatId, "This chat isn't linked to a will. Open Inheirit and choose \"Link Telegram\".");
      return;
    }
    // A reply from a linked chat is a sign of life for each account it is linked to. Only the time is kept.
    const at = this.now().toISOString();
    this.store.update((s) => {
      for (const a of accounts) s.telegramReplies[a] = at;
    });
    this.log(`[telegram] reply received for ${accounts.join(", ")}`);
    this.onReply?.(accounts);
    await this.api.sendMessage(chatId, "Thanks, noted. Nothing else happens.");
  }

  /** One long-poll round; returns how many updates were handled. */
  async pollOnce(timeoutS = 25): Promise<number> {
    const updates = await this.api.getUpdates(this.store.get().telegramOffset, timeoutS);
    for (const u of updates) {
      try {
        await this.handle(u);
      } catch (e) {
        this.log(`[telegram] update failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.store.update((s) => (s.telegramOffset = u.update_id + 1));
    }
    return updates.length;
  }

  /** Polls forever; errors back off and never stop the loop. */
  async run(): Promise<never> {
    for (;;) {
      try {
        await this.pollOnce();
      } catch (e) {
        this.log(`[telegram] poll failed: ${e instanceof Error ? e.message : String(e)}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}
