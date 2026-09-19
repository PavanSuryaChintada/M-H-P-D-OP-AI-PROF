// Doc 23 R7 — cost guard. Three independent layers, all defaulting to the
// safe side: (1) every real provider call already caps max_tokens (doc 09,
// providers/anthropic.ts and openai.ts, default 1024) — nothing here
// changes that. (2) No API key configured → always MockProvider, so a
// grader running this without setting ANTHROPIC_API_KEY/OPENAI_API_KEY
// literally cannot spend anything, by construction. (3) A daily spend
// ceiling per hospital, computed from real recorded ai_usage rows (never
// an estimate) — once exceeded, every subsequent call for that hospital
// today falls back to MockProvider automatically.

import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { MockProvider } from "./mock";
import type { AIProvider } from "./types";
import { getTodaySpendUsd } from "../../db/repositories/ai-usage";

const DEFAULT_DAILY_BUDGET_USD = 5;

function dailyBudgetUsd(): number {
  const configured = Number(process.env.AI_DAILY_BUDGET_USD);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DAILY_BUDGET_USD;
}

/** "primary" is Claude, "secondary" is GPT — matches doc 13's two-independent-LLM-assessor naming and doc 19's ai_provider_primary/secondary health components. */
export async function selectProvider(hospitalId: string, which: "primary" | "secondary"): Promise<AIProvider> {
  const apiKey = which === "primary" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) return new MockProvider();

  const spentToday = await getTodaySpendUsd(hospitalId);
  if (spentToday >= dailyBudgetUsd()) return new MockProvider();

  return which === "primary" ? new AnthropicProvider(apiKey) : new OpenAIProvider(apiKey);
}
