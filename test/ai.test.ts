import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  AttestationGate,
  checkCompose,
  checkReportData,
  verifyModel,
  type Attestation,
  type AttestationDeps,
  type AttestationResult,
} from "../src/ai/attestation";
import { verifyChatSignature, type ChatResult } from "../src/ai/nearai";
import { heirFacts, heirGuide } from "../src/ai/heir-guide";
import { draftPolicy, type PolicyAi } from "../src/ai/policy-parser";
import type { WillView } from "../src/near/will-contract";
import { checkPolicy } from "../src/policy/policy";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NONCE = "ab".repeat(32);
const signer = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const ADDR = signer.address;
const COMPOSE = JSON.stringify({ docker_compose_file: "services: {}" });

function reportDataFor(address: string, nonce: string) {
  const addr = Buffer.from(address.replace(/^0x/, ""), "hex");
  return Buffer.concat([addr, Buffer.alloc(32 - addr.length), Buffer.from(nonce, "hex")]).toString("hex");
}

function att(extra: Partial<Attestation> = {}): Attestation {
  return {
    intel_quote: "00",
    signing_address: ADDR,
    signing_algo: "ecdsa",
    nvidia_payload: JSON.stringify({ nonce: NONCE }),
    info: { tcb_info: JSON.stringify({ app_compose: COMPOSE }) },
    ...extra,
  };
}

function deps(over: Partial<AttestationDeps> = {}, reportNonce = NONCE): AttestationDeps {
  return {
    fetchReport: async () => ({ gateway_attestation: att({ nvidia_payload: undefined }), model_attestations: [att()] }),
    verifyQuote: async () => ({ status: "UpToDate", reportData: reportDataFor(ADDR, reportNonce), mrConfig: "01" + sha(COMPOSE) }),
    verifyGpu: async () => true,
    ...over,
  };
}

describe("attestation checks", () => {
  it("report_data must bind the signing address and our nonce", () => {
    expect(checkReportData(att(), NONCE, reportDataFor(ADDR, NONCE)).every((c) => c.ok)).toBe(true);
    const wrongNonce = checkReportData(att(), NONCE, reportDataFor(ADDR, "cd".repeat(32)));
    expect(wrongNonce.find((c) => c.name.includes("nonce"))!.ok).toBe(false);
    const wrongAddr = checkReportData(att(), NONCE, reportDataFor("0x" + "22".repeat(20), NONCE));
    expect(wrongAddr.find((c) => c.name.includes("address"))!.ok).toBe(false);
  });

  it("mr_config must be 01 || sha256(app_compose)", () => {
    expect(checkCompose(att(), "01" + sha(COMPOSE)).ok).toBe(true);
    expect(checkCompose(att(), "01" + sha("other")).ok).toBe(false);
  });

  it("passes only when gateway and every model pass", async () => {
    const r = await verifyModel("m", deps(), NONCE);
    expect(r.ok).toBe(true);
    expect(r.attestedSigners).toEqual([ADDR.toLowerCase()]);
    expect(r.models[0].checks.map((c) => c.name)).toContain("NVIDIA GPU attestation");
  });

  it("fails on a bad TDX status, a failed GPU verdict, or a replayed nonce", async () => {
    expect((await verifyModel("m", deps({ verifyQuote: async () => ({ status: "Revoked", reportData: reportDataFor(ADDR, NONCE), mrConfig: "01" + sha(COMPOSE) }) }), NONCE)).ok).toBe(false);
    expect((await verifyModel("m", deps({ verifyGpu: async () => false }), NONCE)).ok).toBe(false);
    const replay = await verifyModel("m", deps({}, "cd".repeat(32)), NONCE);
    expect(replay.ok).toBe(false);
    expect(replay.attestedSigners).toEqual([]);
  });

  it("fails closed when the model has no attestation (proxied, non-private models)", async () => {
    const r = await verifyModel("anthropic/x", deps({ fetchReport: async () => Promise.reject(new Error("503 TEE attestation")) }), NONCE);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/503/);
    expect((await verifyModel("m", deps({ fetchReport: async () => ({ gateway_attestation: att() }) }), NONCE)).ok).toBe(false);
  });
});

describe("AttestationGate", () => {
  it("caches a pass, re-checks a failure, and require() throws when not attested", async () => {
    let calls = 0;
    let pass = false;
    const gate = new AttestationGate("m", {
      ...deps(),
      fetchReport: async (model, nonce) => {
        calls++;
        if (!pass) throw new Error("down");
        return deps({}, nonce).fetchReport(model, nonce);
      },
      verifyQuote: async () => ({ status: "UpToDate", reportData: "", mrConfig: "" }),
    });
    await expect(gate.require()).rejects.toThrow(/not attested/);
    await expect(gate.require()).rejects.toThrow();
    expect(calls).toBe(2);
    pass = true;
    // verifyQuote returns empty report data, so even a fetched report fails: still not cached
    await expect(gate.require()).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it("does not re-verify a passing result within the TTL", async () => {
    // The gate picks a fresh nonce per check, so the fake quote binds whichever nonce was requested
    let calls = 0;
    let lastNonce = "";
    const gate = new AttestationGate("m", {
      fetchReport: async (_m, n) => {
        calls++;
        lastNonce = n;
        return { gateway_attestation: att({ nvidia_payload: undefined }), model_attestations: [att({ nvidia_payload: JSON.stringify({ nonce: n }) })] };
      },
      verifyQuote: async () => ({ status: "UpToDate", reportData: reportDataFor(ADDR, lastNonce), mrConfig: "01" + sha(COMPOSE) }),
      verifyGpu: async () => true,
    });
    expect((await gate.current()).ok).toBe(true);
    await gate.current();
    expect(calls).toBe(1);
  });
});

async function signedChat(content: string, tamper = false): Promise<{ chat: ChatResult; sig: { text: string; signature: string; signing_address: string } }> {
  const requestBody = JSON.stringify({ model: "m", messages: [] });
  const responseBody = JSON.stringify({ id: "chat-1", choices: [{ message: { content } }] });
  const text = `m:${sha(requestBody)}:${sha(responseBody)}`;
  const signature = await signer.signMessage({ message: text });
  return {
    chat: { id: "chat-1", content, requestBody, responseBody: tamper ? responseBody + " " : responseBody },
    sig: { text, signature, signing_address: ADDR },
  };
}

describe("verifyChatSignature", () => {
  it("accepts a response signed by an attested model address", async () => {
    const { chat, sig } = await signedChat("{}");
    expect((await verifyChatSignature(chat, sig, [ADDR.toLowerCase()])).ok).toBe(true);
  });
  it("rejects a response that differs from what was signed", async () => {
    const { chat, sig } = await signedChat("{}", true);
    expect((await verifyChatSignature(chat, sig, [ADDR.toLowerCase()])).detail).toMatch(/response hash/);
  });
  it("rejects a signer the attestation did not cover", async () => {
    const { chat, sig } = await signedChat("{}");
    expect((await verifyChatSignature(chat, sig, ["0x" + "99".repeat(20)])).detail).toMatch(/not an attested/);
  });
});

const ATTESTED: AttestationResult = {
  ok: true,
  model: "m",
  nonce: NONCE,
  checkedAt: "2026-10-28T00:00:00Z",
  gateway: null,
  models: [],
  attestedSigners: [ADDR.toLowerCase()],
};

function fakeAi(content: string, opts: { badSig?: boolean } = {}): PolicyAi & { chats: number } {
  let pending: Awaited<ReturnType<typeof signedChat>>;
  return {
    model: "m",
    chats: 0,
    async chat() {
      this.chats++;
      pending = await signedChat(content, opts.badSig);
      return pending.chat;
    },
    async signature() {
      return pending.sig;
    },
  };
}

const GOOD = {
  version: 1,
  owner: "alice.testnet",
  heirs: [
    { id: "h1", name: "Bola", near_account: "bola.testnet", receive: { eth: "0x" + "1".repeat(40) } },
    { id: "h2", name: "Charity", near_account: "charity.testnet" },
  ],
  allocations: [
    { asset: "NEAR", shares: { h1: 80, h2: 20 } },
    { asset: "ETH", shares: { h1: 100 } },
  ],
  stages_pct: [10, 30, 60],
  guardians: ["g1.testnet", "g2.testnet"],
  guardian_threshold: 2,
};

describe("draftPolicy", () => {
  it("returns a validated policy, its hash and a code-built summary", async () => {
    const ai = fakeAi("```json\n" + JSON.stringify(GOOD) + "\n```");
    const d = await draftPolicy("alice.testnet", "80% NEAR to Bola…", ai, { require: async () => ATTESTED });
    expect(d.errors).toEqual([]);
    expect(d.ok).toBe(true);
    expect(d.policy_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.summary![0]).toBe(`Bola (bola.testnet) receives 80% of your NEAR, 100% of your ETH (to 0x${"1".repeat(40)}).`);
    expect(d.summary!.join(" ")).toMatch(/2 of 2 must confirm/);
  });

  it("reports validation errors and never fixes them", async () => {
    const bad = { ...GOOD, allocations: [{ asset: "NEAR", shares: { h1: 70, h2: 20 } }] };
    const d = await draftPolicy("alice.testnet", "…", fakeAi(JSON.stringify(bad)), { require: async () => ATTESTED });
    expect(d.ok).toBe(false);
    expect(d.errors.join()).toMatch(/sum to 90/);
    expect(d.policy).toBeUndefined();
    expect(d.draft).toEqual(bad);
  });

  it("rejects a draft for a different owner", async () => {
    const d = await draftPolicy("mallory.testnet", "…", fakeAi(JSON.stringify(GOOD)), { require: async () => ATTESTED });
    expect(d.ok).toBe(false);
    expect(d.errors.join()).toMatch(/owner/);
  });

  it("refuses to send the will anywhere if the model isn't attested", async () => {
    const ai = fakeAi(JSON.stringify(GOOD));
    await expect(draftPolicy("alice.testnet", "…", ai, { require: async () => Promise.reject(new Error("not attested")) })).rejects.toThrow();
    expect(ai.chats).toBe(0);
  });

  it("rejects a response whose signature doesn't verify", async () => {
    const d = await draftPolicy("alice.testnet", "…", fakeAi(JSON.stringify(GOOD), { badSig: true }), { require: async () => ATTESTED });
    expect(d.ok).toBe(false);
    expect(d.errors[0]).toMatch(/signature not verified/);
  });
});

const WILL = {
  owner: "alice.testnet",
  heirs: [
    { account_id: "bola.testnet", name: "Bola", near_share_bps: 8000, x25519_pubkey: "ab".repeat(32) },
    { account_id: "charity.testnet", name: "Charity", near_share_bps: 2000, x25519_pubkey: null },
  ],
  guardians: ["g1.testnet"],
  guardian_threshold: 1,
  contacts: [],
  stages_pct: [10, 90],
  timings: {},
  policy_hash: "",
  foreign_chains: ["Eth"],
  state: { Executing: { stage: 0, since: 1, stage_started: 1 } },
  last_alive_at: 0,
  execution_round: 1,
  near_balance: "0",
  pending_withdrawals: [],
  executions: [
    { round: 1, stage: 0, chain: "Near", to: "bola.testnet", amount: "800", tx_hash: "" },
    { round: 1, stage: 0, chain: "Near", to: "charity.testnet", amount: "200", tx_hash: "" },
    { round: 1, stage: 0, chain: "Eth", to: "0x" + "1".repeat(40), amount: "5", tx_hash: "0xabc" },
  ],
  stage_done: [],
  sealed_notes: [{ id: 0, heir: "bola.testnet", label: "Ledger", ciphertext: "SECRETCIPHERTEXT" }],
  released_notes: [],
} as unknown as WillView;

describe("heir guide", () => {
  const policy = (() => {
    const c = checkPolicy(GOOD);
    if (!c.ok) throw new Error("bad fixture");
    return c.policy;
  })();
  it("gives the model only this heir's facts", () => {
    const f = heirFacts(WILL, "bola.testnet", policy);
    expect(f).toContain("Bola");
    expect(f).toContain("stage 1 Near amount 800");
    expect(f).toContain("stage 1 Eth amount 5");
    expect(f).not.toContain("charity");
    expect(f).not.toContain("Charity");
    expect(f).not.toContain("SECRETCIPHERTEXT");
  });
  it("refuses an account that isn't an heir", () => {
    expect(() => heirFacts(WILL, "mallory.testnet", policy)).toThrow("not an heir");
  });
  it("returns an answer only when the signature verifies", async () => {
    const gate = { require: async () => ATTESTED };
    const ok = await heirGuide(WILL, "bola.testnet", policy, "What now?", [], fakeAi("<think>hmm</think>Register your key."), gate);
    expect(ok).toMatchObject({ ok: true, answer: "Register your key." });
    const bad = await heirGuide(WILL, "bola.testnet", policy, "What now?", [], fakeAi("Register your key.", { badSig: true }), gate);
    expect(bad.ok).toBe(false);
    expect(bad.answer).toBeUndefined();
  });
});
