// Plain-English will → policy draft (CLAUDE.md §7.6). The model only drafts. Validation is
// deterministic (checkPolicy), errors are shown and never auto-fixed, and the summary the owner
// approves is generated from the validated policy by code.
import { checkPolicy, policyHash, summarizePolicy, type Policy } from "../policy/policy";
import type { AttestationResult } from "./attestation";
import { verifyChatSignature, type ChatMessage, type ChatResult, type ChatSignature, type ChatVerification } from "./nearai";

export interface PolicyAi {
  model: string;
  chat(messages: ChatMessage[], opts: { json?: boolean }): Promise<ChatResult>;
  signature(chatId: string): Promise<ChatSignature>;
}

export interface AttestationSource {
  require(): Promise<AttestationResult>;
}

export interface PolicyDraft {
  ok: boolean;
  errors: string[];
  policy?: Policy;
  policy_hash?: string;
  summary?: string[];
  /** The model's raw JSON (or text), so the owner can see what was proposed when validation fails. */
  draft?: unknown;
  ai: { model: string; chat_id?: string; attested_at?: string; signature?: ChatVerification };
}

const EXAMPLE = {
  version: 1,
  owner: "alice.testnet",
  heirs: [
    { id: "h1", name: "Bola", near_account: "bola.testnet", receive: { eth: "0x…", btc: "tb1…" } },
    { id: "h2", name: "Charity Fund", near_account: "charity.testnet", receive: { eth: "0x…" } },
  ],
  allocations: [
    { asset: "NEAR", shares: { h1: 80, h2: 20 } },
    { asset: "ETH", shares: { h1: 100 } },
    { asset: "BTC", shares: { h1: 50, h2: 50 } },
  ],
  conditions: [{ heir: "h1", asset: "BTC", type: "not_before", date: "2031-05-01", note: "BTC to Bola when he turns 21" }],
  stages_pct: [10, 30, 60],
  guardians: ["g1.testnet", "g2.testnet", "g3.testnet"],
  guardian_threshold: 2,
  contacts: ["friend@example.com"],
};

export function systemPrompt(owner: string): string {
  return [
    "You turn a person's plain-English crypto will into JSON. Reply with one JSON object and nothing else.",
    `The will's owner is ${owner}; set "owner" to exactly that and "version" to 1.`,
    "Schema, by example (the 0x…/tb1… values are placeholders):",
    JSON.stringify(EXAMPLE, null, 2),
    "Rules:",
    "- Use only facts stated in the text. Never invent NEAR accounts, ETH addresses, BTC addresses, guardians or contacts. Leave out anything not given.",
    "- Heir ids are short lowercase ids (h1, h2, ...). Shares are whole-number percentages per asset that sum to 100. Assets are NEAR, ETH and BTC only.",
    "- stages_pct are whole-number percentages that sum to 100. If the text gives no stages, use [10, 30, 60].",
    "- guardian_threshold is how many guardians must confirm. If not stated, use a majority.",
    "- conditions: only 'not_before' date conditions, written as YYYY-MM-DD.",
    "- If the text is ambiguous, still return your best JSON; a separate validator will report problems to the owner.",
  ].join("\n");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  return JSON.parse(body);
}

async function fetchSignature(ai: PolicyAi, chatId: string, attempts = 3, waitMs = 1000): Promise<ChatSignature> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ai.signature(chatId);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw last;
}

export async function draftPolicy(owner: string, text: string, ai: PolicyAi, gate: AttestationSource): Promise<PolicyDraft> {
  // Refuse before any will content leaves the agent if the model doesn't attest.
  const attestation = await gate.require();
  const info: PolicyDraft["ai"] = { model: ai.model, attested_at: attestation.checkedAt };

  const chat = await ai.chat(
    [
      { role: "system", content: systemPrompt(owner) },
      { role: "user", content: text },
    ],
    { json: true },
  );
  info.chat_id = chat.id;

  try {
    info.signature = await verifyChatSignature(chat, await fetchSignature(ai, chat.id), attestation.attestedSigners);
  } catch (e) {
    info.signature = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  if (!info.signature.ok) {
    return { ok: false, errors: [`AI response signature not verified: ${info.signature.detail}`], ai: info };
  }

  let draft: unknown;
  try {
    draft = extractJson(chat.content);
  } catch {
    return { ok: false, errors: ["The AI did not return valid JSON. Try rephrasing the will."], draft: chat.content, ai: info };
  }
  const check = checkPolicy(draft);
  if (!check.ok) return { ok: false, errors: check.errors, draft, ai: info };
  if (check.policy.owner !== owner) return { ok: false, errors: [`owner: expected ${owner}, got ${check.policy.owner}`], draft, ai: info };
  return { ok: true, errors: [], policy: check.policy, policy_hash: policyHash(check.policy), summary: summarizePolicy(check.policy), draft, ai: info };
}
