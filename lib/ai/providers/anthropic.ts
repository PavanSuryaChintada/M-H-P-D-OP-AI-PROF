// Doc 09 §3 — Claude, used for the Voice Intake and Clinical Triage agents
// (doc 09 §1). Structured output is enforced via forced tool-use: the zod
// schema becomes the tool's input_schema, tool_choice pins the model to it,
// and the returned tool input is re-validated with the same schema before
// it's trusted — a provider that returns something the schema rejects is a
// ProviderValidationError, not a silent pass-through.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AIProvider, GenerateRequest, GenerateResult, StructuredRequest, StructuredResult } from "./types";
import { ProviderValidationError } from "./types";

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-5") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens };
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const toolName = "emit_structured_output";
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      tools: [
        {
          name: toolName,
          description: "Emit the structured result. Always call this exactly once.",
          input_schema: z.toJSONSchema(req.schema) as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: toolName },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) {
      throw new ProviderValidationError(this.id, "model did not call the structured-output tool");
    }
    const parsed = req.schema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new ProviderValidationError(this.id, parsed.error.message);
    }
    return { data: parsed.data, tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens };
  }
}
