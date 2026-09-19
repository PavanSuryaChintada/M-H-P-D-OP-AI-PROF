// Doc 09 §3 — every AI provider call is recorded here, success or failure.
// This is what makes doc 19's AI observability and doc 21's safety eval
// cost/latency reporting possible at all.

import { and, eq, gte, sql } from "drizzle-orm";
import { withTenant, withHospitalContext, type TenantContext } from "../tenant";
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

/** Doc 23 R7 — cost guard input: today's real spend for a hospital, summed from actual recorded calls (never estimated). */
export async function getTodaySpendUsd(hospitalId: string): Promise<number> {
  return withHospitalContext(hospitalId, async (tx) => {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)` })
      .from(aiUsage)
      .where(and(eq(aiUsage.hospitalId, hospitalId), gte(aiUsage.at, sql`date_trunc('day', now())`)));
    return Number(row?.total ?? 0);
  });
}
