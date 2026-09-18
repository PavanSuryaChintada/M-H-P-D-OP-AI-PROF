// Doc 09 §3 — "Timeout 30s, 2 retries with backoff, then circuit-break to
// PROVIDER_ERROR (doc 07 — does not consume a patient attempt)." This is
// the ONE place that policy lives; callers (doc 10/12/13's agents) never
// call a provider directly, they call runStructured()/runGenerate() so
// every AI call gets the same timeout/retry/ai_usage-recording behavior
// regardless of which provider or which agent is calling.

import type { AIProvider, GenerateRequest, GenerateResult, StructuredRequest, StructuredResult } from "./types";
import { recordAiUsage } from "../../db/repositories/ai-usage";
import type { TenantContext } from "../../db/tenant";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;

export interface ManagedCallOptions {
  ctx: TenantContext;
  agent: string;
  purpose?: string;
  promptVersion?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export type ManagedResult<T> =
  | { ok: true; data: T; tokensIn: number; tokensOut: number }
  | { ok: false; code: "PROVIDER_ERROR"; message: string; isValidationFailure?: boolean };

function withTimeout<T>(promise: Promise<T>, ms: number, providerId: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`provider ${providerId} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  attempt: () => Promise<T>,
  maxRetries: number,
): Promise<{ result: T; retryCount: number } | { error: unknown; retryCount: number }> {
  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await attempt();
      return { result, retryCount: i };
    } catch (err) {
      lastError = err;
      if (i < maxRetries) await sleep(BACKOFF_BASE_MS * 2 ** i);
    }
  }
  return { error: lastError, retryCount: maxRetries };
}

export async function runGenerate(
  provider: AIProvider,
  model: string,
  req: GenerateRequest,
  opts: ManagedCallOptions,
): Promise<ManagedResult<GenerateResult>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const start = Date.now();

  const outcome = await withRetry(() => withTimeout(provider.generate(req), timeoutMs, provider.id), maxRetries);
  const latencyMs = Date.now() - start;

  if ("error" in outcome) {
    await recordAiUsage(opts.ctx, {
      agent: opts.agent,
      provider: provider.id,
      model,
      purpose: opts.purpose,
      promptVersion: opts.promptVersion,
      latencyMs,
      success: false,
      retryCount: outcome.retryCount,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    });
    return { ok: false, code: "PROVIDER_ERROR", message: "provider call failed after retries" };
  }

  await recordAiUsage(opts.ctx, {
    agent: opts.agent,
    provider: provider.id,
    model,
    purpose: opts.purpose,
    promptVersion: opts.promptVersion,
    latencyMs,
    success: true,
    tokenInput: outcome.result.tokensIn,
    tokenOutput: outcome.result.tokensOut,
    retryCount: outcome.retryCount,
  });
  return { ok: true, data: outcome.result, tokensIn: outcome.result.tokensIn, tokensOut: outcome.result.tokensOut };
}

export async function runStructured<T>(
  provider: AIProvider,
  model: string,
  req: StructuredRequest<T>,
  opts: ManagedCallOptions,
): Promise<ManagedResult<StructuredResult<T>>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const start = Date.now();

  const outcome = await withRetry(
    () => withTimeout(provider.generateStructured(req), timeoutMs, provider.id),
    maxRetries,
  );
  const latencyMs = Date.now() - start;

  if ("error" in outcome) {
    const isValidationFailure =
      outcome.error instanceof Error && outcome.error.name === "ProviderValidationError";
    await recordAiUsage(opts.ctx, {
      agent: opts.agent,
      provider: provider.id,
      model,
      purpose: opts.purpose,
      promptVersion: opts.promptVersion,
      latencyMs,
      success: false,
      retryCount: outcome.retryCount,
      validationOutcome: isValidationFailure ? "failed" : undefined,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    });
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: outcome.error instanceof Error ? outcome.error.message : "provider call failed after retries",
      isValidationFailure,
    };
  }

  await recordAiUsage(opts.ctx, {
    agent: opts.agent,
    provider: provider.id,
    model,
    purpose: opts.purpose,
    promptVersion: opts.promptVersion,
    latencyMs,
    success: true,
    tokenInput: outcome.result.tokensIn,
    tokenOutput: outcome.result.tokensOut,
    retryCount: outcome.retryCount,
    validationOutcome: "valid",
  });
  return { ok: true, data: outcome.result, tokensIn: outcome.result.tokensIn, tokensOut: outcome.result.tokensOut };
}
