// Doc 18 R3 — Platform Admin dashboard. Doc 01's own rule: "Platform Admin
// cross-hospital aggregate reads are explicitly NOT implemented as an RLS
// bypass." Every tenant table's RLS policy (rls.sql) FORCEs row security
// and checks app.hospital_id — there is no query shape that reads across
// hospitals through the app_user role without it. So this aggregates by
// looping per hospital under withHospitalContext (the same one-hospital-
// at-a-time GUC scoping every worker in this codebase already uses) and
// summing in application code — never a single unscoped cross-hospital
// SQL query. This is R3's own "aggregates only" requirement, enforced by
// construction: nothing here can accidentally select a patient-level row
// from a hospital the caller didn't explicitly scope into.

import { sql } from "drizzle-orm";
import { withEachHospitalContext, type Tx } from "../db/tenant";
import { listHospitals } from "../db/repositories/hospitals";

export interface HospitalActivity {
  hospitalId: string;
  hospitalName: string;
  campaignCount: number;
  activeCalls: number;
  maxConcurrentCalls: number;
  deadLetterEventCount: number;
  stuckTaskCount: number; // CALLING/CONNECTED past lease_expires_at — the reaper should have caught these
}

async function getOneHospitalActivity(hospitalId: string, hospitalName: string, tx: Tx): Promise<HospitalActivity> {
  const [row] = await tx.execute<{
    campaign_count: string;
    active_calls: number;
    max_calls: number;
    dead_letter_count: string;
    stuck_count: string;
  }>(sql`
    select
      (select count(*) from campaigns where hospital_id = ${hospitalId}) as campaign_count,
      coalesce((select current_active_calls from hospital_capacity where hospital_id = ${hospitalId}), 0) as active_calls,
      coalesce((select max_concurrent_calls from hospital_capacity where hospital_id = ${hospitalId}), 0) as max_calls,
      (select count(*) from events where hospital_id = ${hospitalId} and status = 'DEAD') as dead_letter_count,
      (select count(*) from outreach_tasks where hospital_id = ${hospitalId} and state in ('CALLING','CONNECTED') and lease_expires_at < now()) as stuck_count
  `);
  return {
    hospitalId,
    hospitalName,
    campaignCount: Number(row.campaign_count),
    activeCalls: row.active_calls,
    maxConcurrentCalls: row.max_calls,
    deadLetterEventCount: Number(row.dead_letter_count),
    stuckTaskCount: Number(row.stuck_count),
  };
}

export interface PlatformOverview {
  perHospital: HospitalActivity[];
  totals: { campaignCount: number; activeCalls: number; deadLetterEventCount: number; stuckTaskCount: number };
}

export interface AiUsageStat {
  agent: string;
  callCount: number;
  totalTokens: number;
  estimatedCostUsd: number;
  p95LatencyMs: number | null;
  validationFailureRate: number;
}

async function getOneHospitalAiUsage(hospitalId: string, tx: Tx): Promise<AiUsageStat[]> {
  const rows = await tx.execute<{
    agent: string;
    call_count: string;
    total_tokens: string;
    total_cost: string | null;
    p95_latency: string | null;
    failed_count: string;
  }>(sql`
    select
      agent,
      count(*) as call_count,
      coalesce(sum(coalesce(token_input,0) + coalesce(token_output,0)), 0) as total_tokens,
      coalesce(sum(estimated_cost_usd), 0) as total_cost,
      percentile_cont(0.95) within group (order by latency_ms) as p95_latency,
      count(*) filter (where validation_outcome = 'failed') as failed_count
    from ai_usage
    where hospital_id = ${hospitalId}
    group by agent
  `);
  return rows.map((r) => ({
    agent: r.agent,
    callCount: Number(r.call_count),
    totalTokens: Number(r.total_tokens),
    estimatedCostUsd: Number(r.total_cost ?? 0),
    p95LatencyMs: r.p95_latency !== null ? Number(r.p95_latency) : null,
    validationFailureRate: Number(r.call_count) > 0 ? Number(r.failed_count) / Number(r.call_count) : 0,
  }));
}

/**
 * R3's overview and AI-usage numbers used to be two separate per-hospital
 * loops (getPlatformOverview + getPlatformAiUsage), each opening its own
 * withHospitalContext transaction per hospital - 2 full transactions
 * (BEGIN/set_config/query/COMMIT each) per hospital, 64 for 32 hospitals.
 * Measured live: ~13-19s for the combined dashboard call. Folding both
 * queries into the SAME transaction per hospital halves the transaction
 * count; still no unscoped cross-hospital query (R3's own requirement),
 * just one round trip's worth of transaction overhead instead of two.
 */
export async function getPlatformStats(): Promise<{ overview: PlatformOverview; aiUsage: AiUsageStat[] }> {
  const hospitals = await listHospitals();
  const hospitalNames = new Map(hospitals.map((h) => [h.id, h.name]));
  // One shared transaction across every hospital, not one withHospitalContext
  // (i.e. one db.transaction()) per hospital - see withEachHospitalContext
  // for why: N separate transactions fired per request was observed live
  // throwing "there is already a transaction in progress" against
  // Supabase's Supavisor pooler and hanging the whole request as the
  // hospital count grew, not just running slow.
  const perHospital = await withEachHospitalContext(
    hospitals.map((h) => h.id),
    async (tx, hospitalId) => ({
      activity: await getOneHospitalActivity(hospitalId, hospitalNames.get(hospitalId)!, tx),
      aiUsage: await getOneHospitalAiUsage(hospitalId, tx),
    }),
  );

  const totals = perHospital.reduce(
    (acc, { activity }) => ({
      campaignCount: acc.campaignCount + activity.campaignCount,
      activeCalls: acc.activeCalls + activity.activeCalls,
      deadLetterEventCount: acc.deadLetterEventCount + activity.deadLetterEventCount,
      stuckTaskCount: acc.stuckTaskCount + activity.stuckTaskCount,
    }),
    { campaignCount: 0, activeCalls: 0, deadLetterEventCount: 0, stuckTaskCount: 0 },
  );

  const byAgent = new Map<string, AiUsageStat>();
  for (const { aiUsage } of perHospital) {
    for (const s of aiUsage) {
      const existing = byAgent.get(s.agent);
      if (!existing) {
        byAgent.set(s.agent, { ...s });
        continue;
      }
      const combinedCalls = existing.callCount + s.callCount;
      existing.totalTokens += s.totalTokens;
      existing.estimatedCostUsd += s.estimatedCostUsd;
      // p95 across hospitals isn't reconstructable from each hospital's own p95 without
      // the raw samples; approximated here as the max of per-hospital p95s, which is
      // conservative (never understates tail latency) rather than falsely precise.
      existing.p95LatencyMs =
        existing.p95LatencyMs === null && s.p95LatencyMs === null
          ? null
          : Math.max(existing.p95LatencyMs ?? 0, s.p95LatencyMs ?? 0);
      existing.validationFailureRate =
        combinedCalls > 0
          ? (existing.validationFailureRate * existing.callCount + s.validationFailureRate * s.callCount) / combinedCalls
          : 0;
      existing.callCount = combinedCalls;
    }
  }

  return {
    overview: { perHospital: perHospital.map((h) => h.activity), totals },
    aiUsage: Array.from(byAgent.values()),
  };
}
