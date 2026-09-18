// Doc 09 §3 — GPT, used as the Second Assessor (doc 09 §1/doc 13): a
// different vendor, different training, framed differently from the
// Claude assessor, so its failure modes are at least partially
// independent — two LLMs quietly sharing the same blind spot is weak
// evidence, which is the whole point of having this provider at all.
// Structured output uses OpenAI's function-calling, same re-validation
// discipline as AnthropicProvider — never trust the model's own claim of
// schema conformance.

import OpenAI from "openai";
import { z } from "zod";
import type { AIProvider, GenerateRequest, GenerateResult, StructuredRequest, StructuredResult } from "./types";
import { ProviderValidationError } from "./types";

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-5") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "";
    return {
      text,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    };
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const toolName = "emit_structured_output";
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: toolName,
            description: "Emit the structured result. Always call this exactly once.",
            parameters: z.toJSONSchema(req.schema) as Record<string, unknown>,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: toolName } },
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function") {
      throw new ProviderValidationError(this.id, "model did not call the structured-output function");
    }

    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new ProviderValidationError(this.id, "function arguments were not valid JSON");
    }

    const parsed = req.schema.safeParse(rawArgs);
    if (!parsed.success) {
      throw new ProviderValidationError(this.id, parsed.error.message);
    }
    return {
      data: parsed.data,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    };
  }
}
