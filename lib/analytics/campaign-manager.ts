// Doc 18 R1 — Campaign Manager dashboard queries. Every function is
// tenant-scoped through withTenant/withHospitalContext exactly like every
// other repository in this codebase — RLS enforces hospital_id filtering
// even if a query here forgot a WHERE clause, but each one includes it
// explicitly anyway, since "the DB would have caught it" isn't a reason to
// skip writing a correct query.

import { sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "../db/tenant";

export interface CampaignProgress {
  eligible: number;
  attempted: number;
  completed: number;
  escalated: number;
  manual: number;
  failed: number;
}

export async function getCampaignProgress(ctx: TenantContext, campaignId: string): Promise<CampaignProgress> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.execute<{
      eligible: string;
      attempted: string;
      completed: string;
      escalated: string;
      manual: string;
      failed: string;
    }>(sql`
      select
        (select count(*) from eligibility_evaluations where campaign_id = ${campaignId} and status = 'ELIGIBLE') as eligible,
        (select count(*) from outreach_tasks where campaign_id = ${campaignId} and attempt_count > 0) as attempted,
        (select count(*) from outreach_tasks where campaign_id = ${campaignId} and state = 'COMPLETED') as completed,
        (select count(*) from outreach_tasks where campaign_id = ${campaignId} and state = 'ESCALATED') as escalated,
        (select count(*) from outreach_tasks where campaign_id = ${campaignId} and state = 'MANUAL_FOLLOW_UP') as manual,
        (select count(*) from outreach_tasks where campaign_id = ${campaignId} and state = 'FAILED') as failed
    `);
    return {
      eligible: Number(row.eligible),
      attempted: Number(row.attempted),
      completed: Number(row.completed),
      escalated: Number(row.escalated),
      manual: Number(row.manual),
      failed: Number(row.failed),
    };
  });
}

/** R1 — "the single most important widget in the product." */
export async function getCapacityGauge(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.execute<{ current_active_calls: number; max_concurrent_calls: number }>(sql`
      select current_active_calls, max_concurrent_calls from hospital_capacity where hospital_id = ${ctx.hospitalId}
    `);
    return row ? { active: row.current_active_calls, max: row.max_concurrent_calls } : { active: 0, max: 0 };
  });
}

export interface QueueDepth {
  byState: Record<string, number>;
  oldestPendingAgeSeconds: number | null;
}

export async function getQueueDepth(ctx: TenantContext, campaignId?: string): Promise<QueueDepth> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ state: string; count: string }>(
      campaignId
        ? sql`select state, count(*) from outreach_tasks where hospital_id = ${ctx.hospitalId} and campaign_id = ${campaignId} group by state`
        : sql`select state, count(*) from outreach_tasks where hospital_id = ${ctx.hospitalId} group by state`,
    );
    const byState: Record<string, number> = {};
    for (const r of rows) byState[r.state] = Number(r.count);

    const [oldest] = await tx.execute<{ age_seconds: number | null }>(
      campaignId
        ? sql`select extract(epoch from (now() - min(created_at)))::int as age_seconds from outreach_tasks where hospital_id = ${ctx.hospitalId} and campaign_id = ${campaignId} and state = 'PENDING'`
        : sql`select extract(epoch from (now() - min(created_at)))::int as age_seconds from outreach_tasks where hospital_id = ${ctx.hospitalId} and state = 'PENDING'`,
    );
    return { byState, oldestPendingAgeSeconds: oldest?.age_seconds ?? null };
  });
}

/** R1 — "patients approaching clinical cutoff (Tier 1 count) — highlighted." Tier 1 = cutoff-risk, per lib/queue/tier.ts. */
export async function getCutoffApproachingCount(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.execute<{ count: string }>(
      sql`select count(*) from outreach_tasks where hospital_id = ${ctx.hospitalId} and tier = 1 and state not in ('COMPLETED','MANUAL_FOLLOW_UP','FAILED','ESCALATED')`,
    );
    return Number(row.count);
  });
}

export async function getRetryBacklogCount(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.execute<{ count: string }>(
      sql`select count(*) from outreach_tasks where hospital_id = ${ctx.hospitalId} and state = 'RETRY_SCHEDULED'`,
    );
    return Number(row.count);
  });
}

export interface UpcomingCallback {
  taskId: string;
  patientId: string;
  callbackRequestedAt: string;
}

export async function getUpcomingCallbacks(ctx: TenantContext, hours = 4): Promise<UpcomingCallback[]> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string; patient_id: string; callback_requested_at: string }>(sql`
      select id, patient_id, callback_requested_at from outreach_tasks
       where hospital_id = ${ctx.hospitalId}
         and state = 'CALLBACK_SCHEDULED'
         and callback_requested_at between now() and now() + (${hours} || ' hours')::interval
       order by callback_requested_at asc
    `);
    return rows.map((r) => ({ taskId: r.id, patientId: r.patient_id, callbackRequestedAt: r.callback_requested_at }));
  });
}
