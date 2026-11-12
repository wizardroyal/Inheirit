import { describe, expect, it } from "vitest";
import { Driver } from "../src/escalation/driver";
import { EMAIL_DEMO_PER_DAY, EMAIL_FOOTER, EMAIL_GLOBAL_PER_DAY, EMAIL_PER_ADDRESS_PER_DAY, ResendMailer, type Mailer, type SendResult } from "../src/notify/email";
import { allowedOrigin } from "../src/api";
import { Store } from "../src/state/store";
import type { WillState, WillView } from "../src/near/will-contract";

describe("ResendMailer", () => {
  it("posts one plain-text email with the key as a bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("{}"))) as unknown as typeof fetch;
    const m = new ResendMailer("re_key", "checks@mail.example", fetchImpl);
    expect(await m.send("bola@example.com", "Hi", "Body")).toBe("sent");
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_key");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ from: "checks@mail.example", to: ["bola@example.com"], subject: "Hi", text: "Body" });
  });

  it("caps each address per day and refuses non-addresses", async () => {
    const fetchImpl = (async () => new Response("{}")) as unknown as typeof fetch;
    const m = new ResendMailer("k", "f@x.io", fetchImpl, () => 0);
    for (let i = 0; i < EMAIL_PER_ADDRESS_PER_DAY; i++) expect(await m.send("a@b.co", "s", "t")).toBe("sent");
    expect(await m.send("A@b.co", "s", "t")).toBe("capped");
    expect(await m.send("someone.testnet", "s", "t")).toBe("invalid");
  });

  it("demo-timing wills draw from a smaller budget, so real wills keep room under the daily total", async () => {
    const fetchImpl = (async () => new Response("{}")) as unknown as typeof fetch;
    const m = new ResendMailer("k", "f@x.io", fetchImpl, () => 0);
    for (let i = 0; i < EMAIL_DEMO_PER_DAY; i++) expect(await m.send(`d${i}@x.io`, "s", "t", { demo: true })).toBe("sent");
    expect(await m.send("one-more@x.io", "s", "t", { demo: true })).toBe("capped");
    for (let i = EMAIL_DEMO_PER_DAY; i < EMAIL_GLOBAL_PER_DAY; i++) expect(await m.send(`r${i}@x.io`, "s", "t")).toBe("sent");
    expect(await m.send("over@x.io", "s", "t")).toBe("capped");
  });

  it("a provider error names neither the address nor the content", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch;
    const err = await new ResendMailer("k", "f@x.io", fetchImpl).send("secret@person.org", "subject", "private body").catch((e: Error) => e.message);
    expect(err).toBe("email provider answered 422");
  });
});

const T0 = 1_800_000_000;
function will(state: WillState): WillView {
  return {
    owner: "alice.testnet",
    heirs: [{ account_id: "bola.testnet", name: "Bola", near_share_bps: 10000, x25519_pubkey: null }],
    guardians: [
      { account_id: "g1.testnet", accepted: true },
      { account_id: "g2.testnet", accepted: true },
    ],
    guardian_threshold: 2,
    contacts: ["friend.testnet"],
    stages: [{ pct: 100, wait_after: 30 }],
    accelerated_stages: [{ pct: 100, wait_after: 30 }],
    round_stages: [],
    timings: { quiet_after: 86_400, nudge_period: 40, welfare_period: 60, vote_period: 300, challenge_period: 120, secrets_buffer: 60 }, // real timings unless a test says otherwise
    policy_hash: "0".repeat(64),
    foreign_chains: [],
    lawyer: "lawyer.testnet",
    heirs_hidden: true,
    accelerated: false,
    state,
    last_alive_at: T0,
    execution_round: 0,
    near_balance: "0",
    pending_withdrawals: [],
    executions: [],
    stage_done: [],
    sealed_notes: [],
    released_notes: [],
  };
}

function setup(state: WillState) {
  const sent: [string, string][] = [];
  const bodies: string[] = [];
  let result: SendResult = "sent";
  const mailer: Mailer = { send: async (to, subject, text) => (result === "sent" && (sent.push([to, subject]), bodies.push(text)), result) };
  const store = new Store(null);
  store.update(
    (s) =>
      (s.owners["alice.testnet"] = {
        owner: "alice.testnet",
        email: "alice@example.com",
        peopleEmails: { "friend.testnet": "friend@example.com", "lawyer.testnet": "lawyer@example.com", "g1.testnet": "g1@example.com" },
      }),
  );
  let nowS = T0 + 150;
  const w = will(state);
  const contract = {
    w,
    getWill: async () => w,
    advance: async () => false,
    recordLiveness: async () => true,
  };
  const driver = new Driver({ contract: contract as never, adapters: [], store, mailer, now: () => new Date(nowS * 1000), log: () => {} });
  return { driver, store, sent, bodies, w, setNow: (s: number) => (nowS = s), setResult: (r: SendResult) => (result = r) };
}

describe("agent CORS", () => {
  it("allows the app's domains and localhost, nothing else", () => {
    for (const o of ["https://inheirit.xyz", "https://www.inheirit.xyz", "https://inheirit.vercel.app", "http://localhost:3100"]) expect(allowedOrigin(o)).toBe(true);
    for (const o of ["https://evil.example", "https://inheirit.xyz.evil.io", undefined]) expect(allowedOrigin(o)).toBe(false);
  });
});

describe("email delivery", () => {
  it("every email says how to answer (replies aren't read)", async () => {
    const t = setup({ WelfareCheck: { since: T0 + 150 } });
    await t.driver.tick();
    expect(t.bodies.length).toBeGreaterThan(0);
    for (const b of t.bodies) expect(b.endsWith(EMAIL_FOOTER)).toBe(true);
  });

  it("on demo timings, one email per address per run; the app says so instead", async () => {
    const t = setup({ GuardianVote: { since: T0 + 150 } });
    t.w.timings = { ...t.w.timings, quiet_after: 120 }; // a speedrun
    await t.driver.tick();
    expect(t.sent.filter(([to]) => to === "g1@example.com")).toHaveLength(1);
    // First challenge alarm of this run: it goes out.
    t.w.state = { Challenge: { since: T0 + 300 } };
    t.setNow(T0 + 305);
    await t.driver.tick();
    expect(t.sent.filter(([to]) => to === "alice@example.com")).toHaveLength(1);
    // A second challenge in the same run: no second email to the owner.
    t.w.state = "Active";
    await t.driver.tick();
    t.w.state = { Challenge: { since: T0 + 700 } };
    t.setNow(T0 + 705);
    await t.driver.tick();
    expect(t.sent.filter(([to]) => to === "alice@example.com")).toHaveLength(1);
    expect(t.store.get().notifications.some((n) => n.channels.includes("email (one per run on demo timings; shown here instead)"))).toBe(true);
  });

  it("when the daily limit is reached, the message stays in the app with a note", async () => {
    const t = setup({ WelfareCheck: { since: T0 + 150 } });
    t.setResult("capped");
    await t.driver.tick();
    expect(t.store.get().notifications.find((n) => n.event === "WelfareCheck")?.channels).toContain("email (daily limit reached; shown here instead)");
  });

  it("emails the owner's check in Quiet, once per silence", async () => {
    const t = setup({ Quiet: { since: T0 + 100 } });
    t.setNow(T0 + 125);
    await t.driver.tick();
    expect(t.sent).toEqual([["alice@example.com", "Inheirit: just checking in"]]);
    expect(t.store.get().notifications.find((n) => n.subject === "Check: email")?.channels).toEqual(["email"]);
  });

  it("welfare emails go to friends and the lawyer (and guardians who gave an address)", async () => {
    const t = setup({ WelfareCheck: { since: T0 + 150 } });
    await t.driver.tick();
    expect(t.sent.map(([to]) => to).sort()).toEqual(["friend@example.com", "g1@example.com", "lawyer@example.com"]);
    expect(t.store.get().notifications.find((n) => n.event === "WelfareCheck")?.channels).toContain("email");
  });

  it("the challenge alarm emails the owner every time; a repeated vote request doesn't", async () => {
    const t = setup({ GuardianVote: { since: T0 + 150 } });
    await t.driver.tick();
    t.w.state = "Active";
    await t.driver.tick();
    t.w.state = { GuardianVote: { since: T0 + 500 } };
    t.setNow(T0 + 510);
    await t.driver.tick();
    expect(t.sent.filter(([to]) => to === "g1@example.com")).toHaveLength(1);
    for (const since of [T0 + 900, T0 + 1300]) {
      t.w.state = { Challenge: { since } };
      t.setNow(since + 5);
      await t.driver.tick();
      t.w.state = "Active";
      await t.driver.tick();
    }
    expect(t.sent.filter(([to, s]) => to === "alice@example.com" && s.startsWith("Your will starts releasing"))).toHaveLength(2);
  });
});
