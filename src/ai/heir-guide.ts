// Heir claim guide (CLAUDE.md §7.6): a plain-language helper on the heir's claim page. The model sees
// only this heir's own claim facts, built here by code (never note contents, never other heirs'
// shares), and an answer is returned only if its signature recovers to an attested model address.
import type { WillView } from "../near/will-contract";
import { stateName } from "../near/will-contract";
import type { Policy } from "../policy/policy";
import { verifyChatSignature, type ChatMessage, type ChatVerification } from "./nearai";
import { fetchSignature, type AttestationSource, type PolicyAi } from "./policy-parser";

export interface GuideTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GuideAnswer {
  ok: boolean;
  answer?: string;
  error?: string;
  ai: { model: string; attested_at?: string; signature?: ChatVerification };
}

const MAX_HISTORY = 8;

/** The facts the guide may use: this heir's view of the will, as plain text. */
export function heirFacts(will: WillView, heir: string, policy: Policy | undefined): string {
  const h = will.heirs.find((x) => x.account_id === heir);
  if (!h) throw new Error("not an heir of this will");
  const ph = policy?.heirs.find((x) => x.near_account === heir);
  const mine = new Set([heir, ph?.receive.eth?.toLowerCase(), ph?.receive.btc].filter(Boolean) as string[]);
  const round = will.execution_round;
  const received = will.executions.filter((e) => e.round === round && mine.has(e.chain === "Eth" ? e.to.toLowerCase() : e.to));
  const notesFor = will.sealed_notes.filter((n) => n.heir === heir);
  const released = will.released_notes.filter((n) => n.heir === heir);
  const state = stateName(will.state);
  const lines = [
    `Heir: ${h.name} (NEAR account ${heir}). Will owner: ${will.owner}.`,
    `Will state: ${state}. Ladder: Active → Quiet → WelfareCheck → GuardianVote → Challenge → Executing (stages) → SecretsBuffer → SecretsReleased → Completed. Any sign of life from the owner before Completed stops it and halts remaining stages and unreleased notes. Sealed notes are released only in SecretsReleased, after all funds are distributed and a buffer passes.`,
    `Release stages: ${(will.round_stages.length ? will.round_stages : will.stages).map((s) => `${s.pct}%`).join(", ")}${will.accelerated ? " (accelerated after a death proof)" : ""}. Chains: NEAR${will.foreign_chains.map((c) => (c === "Eth" ? ", Ethereum Sepolia" : ", Bitcoin testnet4")).join("")}.`,
    `This heir's share of NEAR: ${h.near_share_bps / 100}%.`,
    `Received so far in the current round: ${received.length ? received.map((e) => `stage ${e.stage + 1} ${e.chain} amount ${e.amount} (${e.chain === "Near" ? "yoctoNEAR" : e.chain === "Eth" ? "wei" : "sats"})`).join("; ") : "nothing"}.`,
    `Note key registered: ${h.x25519_pubkey ? "yes" : "no"}. Sealed notes for this heir: ${notesFor.length}; released to their key: ${released.length}.`,
    `The claim page has 4 steps: 1 choose your account; 2 create and register your private note key (keep the backup file); 3 see what you receive with explorer links; 4 decrypt released notes in the browser.`,
  ];
  return lines.join("\n");
}

export function guideSystemPrompt(facts: string): string {
  return [
    "You are a calm, kind guide on Inheirit, a crypto will app, helping someone who may be grieving and may not know crypto.",
    "Explain in plain language, briefly (under 150 words), what is happening and what to click next on the claim page.",
    "Use only the facts below. If something isn't in the facts, say you don't know. Never invent amounts or dates.",
    "Never ask for or accept seed phrases, private keys or passwords. Don't give legal or tax advice; suggest a professional instead.",
    "This is a testnet demo: assets have no real value.",
    "",
    "FACTS:",
    facts,
  ].join("\n");
}

export async function heirGuide(
  will: WillView,
  heir: string,
  policy: Policy | undefined,
  question: string,
  history: GuideTurn[],
  ai: PolicyAi,
  gate: AttestationSource,
): Promise<GuideAnswer> {
  const facts = heirFacts(will, heir, policy);
  const attestation = await gate.require();
  const info: GuideAnswer["ai"] = { model: ai.model, attested_at: attestation.checkedAt };
  const messages: ChatMessage[] = [
    { role: "system", content: guideSystemPrompt(facts) },
    ...history.slice(-MAX_HISTORY),
    { role: "user", content: question },
  ];
  const chat = await ai.chat(messages, {});
  try {
    info.signature = await verifyChatSignature(chat, await fetchSignature(ai, chat.id), attestation.attestedSigners);
  } catch (e) {
    info.signature = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  if (!info.signature.ok) return { ok: false, error: `AI response signature not verified: ${info.signature.detail}`, ai: info };
  return { ok: true, answer: stripThinking(chat.content), ai: info };
}

/** Some models prefix a <think>…</think> block; heirs should see only the answer. */
function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
