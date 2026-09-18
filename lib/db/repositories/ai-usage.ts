// Doc 09 §3 — every AI provider call is recorded here, success or failure.
// This is what makes doc 19's AI observability and doc 21's safety eval
// cost/latency reporting possible at all.

import { withTenant, type TenantContext } from "../tenant";
import { aiUsage } from "../schema";

export interface RecordAiUsageInput {
  agent: string;
  provider: string;
  model: string;
  purpose?: string;
  promptVersion?: string;
  latencyMs: number;
  success: boolean;
  tokenInput?: number;
  tokenOutput?: number;
  estimatedCostUsd?: number;
  retryCount?: number;
  validationOutcome?: "valid" | "repaired" | "failed";
  error?: string;
}

export async function recordAiUsage(ctx: TenantContext, input: RecordAiUsageInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(aiUsage)
      .values({
        ...input,
        hospitalId: ctx.hospitalId,
        // numeric columns take strings through postgres.js/drizzle, not JS numbers.
        estimatedCostUsd: input.estimatedCostUsd != null ? String(input.estimatedCostUsd) : undefined,
      })
      .returning();
    return row;
  });
}
