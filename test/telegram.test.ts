import { describe, expect, it } from "vitest";
import { Store } from "../src/state/store";
import { HttpTelegramApi, TelegramBot, type TelegramApi, type TelegramUpdate } from "../src/telegram/bot";
import { TelegramAdapter } from "../src/signals/adapters";

class FakeApi implements TelegramApi {
  updates: TelegramUpdate[] = [];
  sent: [number, string][] = [];
  async getUpdates(offset: number) {
    return this.updates.filter((u) => u.update_id >= offset);
  }
  async sendMessage(chatId: number, text: string) {
    this.sent.push([chatId, text]);
  }
}

function setup() {
  const api = new FakeApi();
  const store = new Store(null);
  let nowMs = Date.parse("2026-11-05T12:00:00Z");
  const bot = new TelegramBot(api, store, "inheirit_bot", { now: () => new Date(nowMs), log: () => {} });
  const msg = (update_id: number, chat: number, text: string): TelegramUpdate => ({ update_id, message: { chat: { id: chat }, text } });
  return { api, store, bot, msg, advance: (ms: number) => (nowMs += ms) };
}

describe("TelegramBot", () => {
  it("links a chat through a one-time deep link", async () => {
    const t = setup();
    const { url } = t.bot.issueLink("alice.testnet");
    const token = new URL(url).searchParams.get("start")!;
    expect(url).toMatch(/^https:\/\/t\.me\/inheirit_bot\?start=/);
    await t.bot.handle(t.msg(1, 42, `/start ${token}`));
    expect(t.bot.isLinked("alice.testnet")).toBe(true);
    expect(t.store.get().telegramChats["alice.testnet"].chatId).toBe(42);
    // The token is single-use: a second chat can't take over the link.
    await t.bot.handle(t.msg(2, 99, `/start ${token}`));
    expect(t.store.get().telegramChats["alice.testnet"].chatId).toBe(42);
    expect(t.api.sent.at(-1)?.[1]).toMatch(/not valid/);
  });

  it("refuses to link a group chat (any member's message would count as the owner's)", async () => {
    const t = setup();
    const token = new URL(t.bot.issueLink("alice.testnet").url).searchParams.get("start")!;
    await t.bot.handle({ update_id: 1, message: { chat: { id: -100, type: "group" }, text: `/start ${token}` } });
    expect(t.bot.isLinked("alice.testnet")).toBe(false);
    expect(t.api.sent.at(-1)?.[1]).toMatch(/private chat/);
  });

  it("rejects an expired link", async () => {
    const t = setup();
    const token = new URL(t.bot.issueLink("alice.testnet").url).searchParams.get("start")!;
    t.advance(16 * 60_000);
    await t.bot.handle(t.msg(1, 42, `/start ${token}`));
    expect(t.bot.isLinked("alice.testnet")).toBe(false);
  });

  it("records only the time of a reply from a linked chat, never its text", async () => {
    const t = setup();
    const token = new URL(t.bot.issueLink("alice.testnet").url).searchParams.get("start")!;
    await t.bot.handle(t.msg(1, 42, `/start ${token}`));
    t.advance(1000);
    await t.bot.handle(t.msg(2, 42, "I'm fine, at my sister's"));
    expect(t.store.get().telegramReplies["alice.testnet"]).toBe("2026-11-05T12:00:01.000Z");
    expect(JSON.stringify(t.store.get())).not.toContain("sister");
    const at = await new TelegramAdapter(t.store).lastActivity({ owner: "alice.testnet" });
    expect(at?.toISOString()).toBe("2026-11-05T12:00:01.000Z");
  });

  it("ignores messages from chats that aren't linked", async () => {
    const t = setup();
    await t.bot.handle(t.msg(1, 7, "hello"));
    expect(t.store.get().telegramReplies).toEqual({});
  });

  it("unlinks on /unlink", async () => {
    const t = setup();
    const token = new URL(t.bot.issueLink("alice.testnet").url).searchParams.get("start")!;
    await t.bot.handle(t.msg(1, 42, `/start ${token}`));
    await t.bot.handle(t.msg(2, 42, "/unlink"));
    expect(t.bot.isLinked("alice.testnet")).toBe(false);
  });

  it("advances the update offset so updates are handled once", async () => {
    const t = setup();
    t.api.updates = [t.msg(5, 7, "a"), t.msg(6, 7, "b")];
    expect(await t.bot.pollOnce()).toBe(2);
    expect(t.store.get().telegramOffset).toBe(7);
    expect(await t.bot.pollOnce()).toBe(0);
  });

  it("never puts the bot token in an error", async () => {
    const api = new HttpTelegramApi("123:SECRET", (async () => {
      throw new Error("connect to https://api.telegram.org/bot123:SECRET/getUpdates failed");
    }) as unknown as typeof fetch);
    await expect(api.getUpdates(0, 1)).rejects.toThrow(/<token>/);
    await expect(api.getUpdates(0, 1)).rejects.not.toThrow(/SECRET/);
  });
});
