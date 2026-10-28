// NEAR AI Cloud client (OpenAI-compatible, TEE inference). Plain fetch rather than the openai SDK:
// verifying a chat signature needs the exact request and response bytes, which we keep here.
import { createHash } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  id: string;
  content: string;
  /** Exact bytes sent and received; the provider signs sha256 of each. */
  requestBody: string;
  responseBody: string;
}

export interface ChatSignature {
  text: string;
  signature: string;
  signing_address: string;
}

export interface ChatVerification {
  ok: boolean;
  signingAddress?: string;
  detail?: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class NearAiClient {
  constructor(
    readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async chat(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<ChatResult> {
    const requestBody = JSON.stringify({
      model: this.model,
      messages,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    });
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: requestBody,
    });
    const responseBody = await res.text();
    if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${responseBody.slice(0, 200)}`);
    const parsed = JSON.parse(responseBody) as { id: string; choices: { message: { content: string | null } }[] };
    return { id: parsed.id, content: parsed.choices[0]?.message?.content ?? "", requestBody, responseBody };
  }

  async signature(chatId: string): Promise<ChatSignature> {
    const url = `${this.baseUrl}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(this.model)}&signing_algo=ecdsa`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!res.ok) throw new Error(`signature ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as ChatSignature;
  }
}

/**
 * The signed text is `[model:]sha256(request):sha256(response)`. It must match our own bytes, and the
 * ECDSA signature must recover to a signing address the attestation proved is inside the TEE.
 */
export async function verifyChatSignature(chat: ChatResult, sig: ChatSignature, attestedSigners: string[]): Promise<ChatVerification> {
  const parts = sig.text.split(":");
  if (parts.length < 2 || parts.length > 3) return { ok: false, detail: `unexpected signed text format (${parts.length} parts)` };
  const [reqHash, resHash] = parts.slice(-2);
  if (reqHash !== sha256(chat.requestBody)) return { ok: false, detail: "signed request hash doesn't match what we sent" };
  if (resHash !== sha256(chat.responseBody)) return { ok: false, detail: "signed response hash doesn't match what we received" };
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: sig.text, signature: sig.signature as Hex });
  } catch (e) {
    return { ok: false, detail: `bad signature: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (recovered.toLowerCase() !== sig.signing_address.toLowerCase()) return { ok: false, detail: "signature doesn't recover to signing_address" };
  if (!attestedSigners.includes(recovered.toLowerCase())) return { ok: false, signingAddress: recovered, detail: "signer is not an attested model address" };
  return { ok: true, signingAddress: recovered };
}
