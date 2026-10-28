// NEAR AI Cloud attestation checks, so will contents only go to a model that proves it runs in a TEE.
//
// Adapted from nearai/nearai-cloud-verifier (commit 9455472), ts/model_verifier.ts:
// checkTdxQuote, checkReportData, checkGpu, the mr_config/compose check and the compose-manager
// actions hash. MIT License, Copyright (c) 2025 nearai-cloud; see src/ai/LICENSE-nearai-cloud-verifier.
// Changes: each check returns a structured pass/fail instead of logging; quote verification and the
// NVIDIA call are injectable for tests; Sigstore lookups are dropped (informational upstream).
import { createHash, randomBytes } from "node:crypto";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface QuoteVerdict {
  status: string;
  /** hex, 64 bytes */
  reportData: string;
  /** hex */
  mrConfig: string;
}

export interface AttestationDeps {
  fetchReport(model: string, nonce: string): Promise<AttestationReport>;
  verifyQuote(quoteHex: string): Promise<QuoteVerdict>;
  /** Returns NVIDIA NRAS's overall verdict for a GPU evidence payload. */
  verifyGpu(payload: unknown): Promise<boolean>;
}

export interface Attestation {
  intel_quote: string;
  signing_address: string;
  signing_algo?: string;
  nvidia_payload?: string;
  tls_cert_fingerprint?: string;
  info?: { tcb_info?: string | { app_compose?: string } };
  compose_manager_attestation?: unknown;
}

export interface AttestationReport {
  gateway_attestation?: Attestation;
  model_attestations?: Attestation[];
  compose_manager_attestation?: unknown;
}

export interface AttestationResult {
  ok: boolean;
  model: string;
  nonce: string;
  checkedAt: string;
  gateway: { signingAddress: string; checks: Check[] } | null;
  models: { signingAddress: string; checks: Check[] }[];
  /** Model signing addresses that passed every check; chat signatures must recover to one of these. */
  attestedSigners: string[];
  error?: string;
}

// Upstream treats OutOfDate as valid quote crypto with a stale platform TCB; we pass it but report it.
const TDX_STATUS_OK = new Set(["UpToDate", "OutOfDate"]);

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalizeJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + canonicalizeJson(obj[k])).join(",") + "}";
}

function signingAddressPadded32(signingAddress: string, signingAlgo: string): Buffer {
  const hex = signingAlgo === "ecdsa" ? signingAddress.replace(/^0x/i, "") : signingAddress;
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length > 32) throw new Error(`signing address too long: ${bytes.length} bytes`);
  return Buffer.concat([bytes, Buffer.alloc(32 - bytes.length, 0)]);
}

function appCompose(att: Attestation): string | undefined {
  const raw = att.info?.tcb_info;
  if (raw == null) return undefined;
  const tcb = typeof raw === "string" ? (JSON.parse(raw) as { app_compose?: string }) : raw;
  return tcb.app_compose;
}

/** report_data[0..32] binds the signing address (or sha256(address || TLS fingerprint)); [32..64] is our nonce. */
export function checkReportData(att: Attestation, nonce: string, reportDataHex: string): Check[] {
  const reportData = Buffer.from(reportDataHex.replace(/^0x/i, ""), "hex");
  const first = reportData.subarray(0, 32);
  const second = reportData.subarray(32, 64);
  const algo = (att.signing_algo || "ecdsa").toLowerCase();
  let expected: Buffer;
  if (att.tls_cert_fingerprint) {
    const addr = Buffer.from(algo === "ecdsa" ? att.signing_address.replace(/^0x/i, "") : att.signing_address, "hex");
    expected = createHash("sha256").update(addr).update(Buffer.from(att.tls_cert_fingerprint, "hex")).digest();
  } else {
    expected = signingAddressPadded32(att.signing_address, algo);
  }
  const nonceBytes = Buffer.from(nonce, "hex");
  return [
    { name: "report_data binds signing address", ok: first.equals(expected) },
    { name: "report_data binds request nonce", ok: nonceBytes.length === 32 && second.length === 32 && second.equals(nonceBytes) },
  ];
}

/** mr_config = 0x01 || sha256(app_compose): the attested compose is the one in the quote. */
export function checkCompose(att: Attestation, mrConfigHex: string): Check {
  const compose = appCompose(att);
  if (!compose) return { name: "compose matches mr_config", ok: false, detail: "no app_compose in tcb_info" };
  const hash = createHash("sha256").update(compose).digest("hex");
  return { name: "compose matches mr_config", ok: mrConfigHex.toLowerCase().startsWith(("01" + hash).toLowerCase()), detail: hash };
}

/** Optional upstream check: the compose-manager's action log hashes to its stated actions_hash. */
export function checkComposeManager(cm: unknown): Check | null {
  if (!cm) return null;
  let obj: Record<string, unknown>;
  try {
    obj = typeof cm === "string" ? JSON.parse(cm) : (cm as Record<string, unknown>);
  } catch {
    return { name: "compose-manager actions hash", ok: false, detail: "unparseable" };
  }
  if (obj.actions === undefined || obj.actions_hash === undefined) return null;
  const computed = createHash("sha256").update(canonicalizeJson(obj.actions)).digest("hex");
  return { name: "compose-manager actions hash", ok: computed === obj.actions_hash };
}

async function checkOne(att: Attestation, nonce: string, deps: AttestationDeps, gpu: boolean): Promise<Check[]> {
  const checks: Check[] = [];
  let quote: QuoteVerdict;
  try {
    quote = await deps.verifyQuote(att.intel_quote);
  } catch (e) {
    return [{ name: "Intel TDX quote verified", ok: false, detail: e instanceof Error ? e.message : String(e) }];
  }
  checks.push({ name: "Intel TDX quote verified", ok: TDX_STATUS_OK.has(quote.status), detail: quote.status });
  checks.push(...checkReportData(att, nonce, quote.reportData));
  checks.push(checkCompose(att, quote.mrConfig));
  if (gpu) {
    if (!att.nvidia_payload) {
      checks.push({ name: "NVIDIA GPU attestation", ok: false, detail: "no nvidia_payload" });
    } else {
      const payload = JSON.parse(att.nvidia_payload) as { nonce: string };
      checks.push({ name: "GPU evidence uses request nonce", ok: payload.nonce.toLowerCase() === nonce.toLowerCase() });
      try {
        checks.push({ name: "NVIDIA GPU attestation", ok: await deps.verifyGpu(payload) });
      } catch (e) {
        checks.push({ name: "NVIDIA GPU attestation", ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  const cm = checkComposeManager(att.compose_manager_attestation);
  if (cm) checks.push(cm);
  return checks;
}

export async function verifyModel(model: string, deps: AttestationDeps, nonce = randomBytes(32).toString("hex")): Promise<AttestationResult> {
  const base = { model, nonce, checkedAt: new Date().toISOString() };
  let report: AttestationReport;
  try {
    report = await deps.fetchReport(model, nonce);
  } catch (e) {
    // Non-private models answer 503 "TEE attestation" here (Decision log 2026-10-27)
    return { ...base, ok: false, gateway: null, models: [], attestedSigners: [], error: e instanceof Error ? e.message : String(e) };
  }

  const gateway = report.gateway_attestation
    ? { signingAddress: report.gateway_attestation.signing_address, checks: await checkOne(report.gateway_attestation, nonce, deps, false) }
    : null;
  const models = [];
  for (const att of report.model_attestations ?? []) {
    models.push({ signingAddress: att.signing_address, checks: await checkOne(att, nonce, deps, true) });
  }
  const top = checkComposeManager(report.compose_manager_attestation);
  if (top && gateway) gateway.checks.push(top);

  const allOk = (c: Check[]) => c.length > 0 && c.every((x) => x.ok);
  const attestedSigners = models.filter((m) => allOk(m.checks)).map((m) => m.signingAddress.toLowerCase());
  const ok = gateway !== null && allOk(gateway.checks) && models.length > 0 && models.every((m) => allOk(m.checks));
  return { ...base, ok, gateway, models, attestedSigners, error: ok ? undefined : summarizeFailure(gateway, models) };
}

function summarizeFailure(gateway: AttestationResult["gateway"], models: AttestationResult["models"]): string {
  if (!gateway) return "no gateway attestation";
  if (models.length === 0) return "no model attestation";
  const failed = [gateway, ...models].flatMap((a) => a.checks.filter((c) => !c.ok).map((c) => c.name));
  return `failed: ${[...new Set(failed)].join(", ")}`;
}

/** Production dependencies: NEAR AI Cloud, Intel PCS collateral via dcap-qvl (WASM), NVIDIA NRAS. */
export function liveDeps(baseUrl: string, apiKey: string): AttestationDeps {
  return {
    async fetchReport(model, nonce) {
      const url = `${baseUrl}/attestation/report?model=${encodeURIComponent(model)}&nonce=${nonce}&signing_algo=ecdsa`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) throw new Error(`attestation report ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as AttestationReport;
    },
    async verifyQuote(quoteHex) {
      const { js_get_collateral, js_verify } = await import("@phala/dcap-qvl-node");
      const raw = Buffer.from(quoteHex, "hex");
      const collateral = await js_get_collateral("https://api.trustedservices.intel.com/tdx/certification/v4", raw);
      const r = js_verify(raw, collateral, BigInt(Math.floor(Date.now() / 1000))) as {
        status?: string;
        report?: { TD10?: { report_data?: string; mr_config_id?: string } };
      };
      return { status: r.status ?? "unknown", reportData: r.report?.TD10?.report_data ?? "", mrConfig: r.report?.TD10?.mr_config_id ?? "" };
    },
    async verifyGpu(payload) {
      const res = await fetch("https://nras.attestation.nvidia.com/v3/attest/gpu", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`NRAS ${res.status}`);
      const body = (await res.json()) as [string, string][];
      const jwt = body[0][1];
      const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
      return claims["x-nvidia-overall-att-result"] === true;
    },
  };
}

/** Caches a passing result so we don't re-verify on every request; a failure is re-checked next time. */
export class AttestationGate {
  private cached: AttestationResult | null = null;
  constructor(
    private readonly model: string,
    private readonly deps: AttestationDeps,
    private readonly ttlMs = 10 * 60_000,
    private readonly now = () => Date.now(),
  ) {}

  async current(): Promise<AttestationResult> {
    if (this.cached?.ok && this.now() - Date.parse(this.cached.checkedAt) < this.ttlMs) return this.cached;
    this.cached = await verifyModel(this.model, this.deps);
    return this.cached;
  }

  /** Throws unless the model is attested; call before sending will contents. */
  async require(): Promise<AttestationResult> {
    const r = await this.current();
    if (!r.ok) throw new Error(`Refusing to send will contents: ${this.model} is not attested (${r.error})`);
    return r;
  }
}
