// Doc 09 §3 — the provider interface every agent calls through. Never call
// an SDK directly from agent code; always through an AIProvider so
// AnthropicProvider/OpenAIProvider/MockProvider are interchangeable and
// every call can be recorded to ai_usage uniformly.

import type { ZodType } from "zod";

export interface GenerateRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface StructuredRequest<T> {
  system: string;
  prompt: string;
  /** validated on the response; a provider that can't produce valid output throws ValidationError */
  schema: ZodType<T>;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  tokensIn: number;
  tokensOut: number;
}

export interface AIProvider {
  id: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export class ProviderTimeoutError extends Error {
  constructor(providerId: string, ms: number) {
    super(`provider ${providerId} timed out after ${ms}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderValidationError extends Error {
  constructor(providerId: string, detail: string) {
    super(`provider ${providerId} produced output that failed schema validation: ${detail}`);
    this.name = "ProviderValidationError";
  }
}
