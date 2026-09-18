// Doc 09 §3 — deterministic, seeded provider for tests and the doc 08-style
// simulations. Never calls a real API. Structured calls are driven by a
// caller-supplied queue of canned responses (the test/sim knows exactly
// what the "model" should say next); generate() falls back to a
// deterministic string derived from the prompt when no queue is supplied.

import type { AIProvider, GenerateRequest, GenerateResult, StructuredRequest, StructuredResult } from "./types";
import { ProviderValidationError } from "./types";

function deterministicHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export class MockProvider implements AIProvider {
  readonly id = "mock";
  private structuredQueue: unknown[];
  private generateQueue: string[];

  constructor(options: { structuredResponses?: unknown[]; textResponses?: string[] } = {}) {
    this.structuredQueue = options.structuredResponses ? [...options.structuredResponses] : [];
    this.generateQueue = options.textResponses ? [...options.textResponses] : [];
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const text = this.generateQueue.shift() ?? `[mock response ${deterministicHash(req.prompt)}]`;
    return { text, tokensIn: Math.ceil(req.prompt.length / 4), tokensOut: Math.ceil(text.length / 4) };
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (this.structuredQueue.length === 0) {
      throw new Error("MockProvider.generateStructured called with an empty response queue — supply structuredResponses");
    }
    const next = this.structuredQueue.shift();
    const parsed = req.schema.safeParse(next);
    if (!parsed.success) {
      throw new ProviderValidationError(this.id, parsed.error.message);
    }
    return {
      data: parsed.data,
      tokensIn: Math.ceil(req.prompt.length / 4),
      tokensOut: Math.ceil(JSON.stringify(next).length / 4),
    };
  }
}
