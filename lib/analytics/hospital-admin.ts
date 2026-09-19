// Doc 18 R2 — Hospital Admin dashboard queries.

import { sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "../db/tenant";

export interface HospitalOverview {
  campaignCount: number;
  outreachVolume: number; // total calls made
  contactRate: number; // fraction of calls that reached COMPLETED
  avgAttemptsToContact: number | null;
}

export async function getHospitalOverview(ctx: TenantContext): Promise<HospitalOverview> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.execute<{
      campaign_count: string;
      outreach_volume: string;
      completed_count: string;
      avg_attempts: string | null;
    }>(sql`
      select
        (select count(*) from campaigns where hospital_id = ${ctx.hospitalId}) as campaign_count,
        (select count(*) from calls where hospital_id = ${ctx.hospitalId}) as outreach_volume,
        (select count(*) from calls where hospital_id = ${ctx.hospitalId} and outcome = 'COMPLETED') as completed_count,
        (select avg(attempt_count) from outreach_tasks where hospital_id = ${ctx.hospitalId} and state = 'COMPLETED') as avg_attempts
    `);
    const outreachVolume = Number(row.outreach_volume);
    return {
      campaignCount: Number(row.campaign_count),
      outreachVolume,
      contactRate: outreachVolume > 0 ? Number(row.completed_count) / outreachVolume : 0,
      avgAttemptsToContact: row.avg_attempts !== null ? Number(row.avg_attempts) : null,
    };
  });
}

export interface EscalationCounts {
  byPriorityAndStatus: { priority: number; state: string; count: number }[];
  overdueCount: number;
}

export async function getEscalationCounts(ctx: TenantContext): Promise<EscalationCounts> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ priority: number; state: string; count: string }>(sql`
      select priority, state, count(*) from escalations
       where hospital_id = ${ctx.hospitalId}
       group by priority, state
    `);
    const [overdue] = await tx.execute<{ count: string }>(
      sql`select count(*) from escalations where hospital_id = ${ctx.hospitalId} and state = 'OVERDUE'`,
    );
    return {
      byPriorityAndStatus: rows.map((r) => ({ priority: r.priority, state: r.state, count: Number(r.count) })),
      overdueCount: Number(overdue.count),
    };
  });
}

export async function getManualFollowUpBacklogCount(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.execute<{ count: string }>(
      sql`select count(*) from outreach_tasks where hospital_id = ${ctx.hospitalId} and state = 'MANUAL_FOLLOW_UP'`,
    );
    return Number(row.count);
  });
}

export interface EhrSyncHealth {
  pending: number;
  synced: number;
  failed: number;
}

export async function getEhrSyncHealth(ctx: TenantContext): Promise<EhrSyncHealth> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ ehr_sync_status: string; count: string }>(sql`
      select ehr_sync_status, count(*) from documentation_records where hospital_id = ${ctx.hospitalId} group by ehr_sync_status
    `);
    const result: EhrSyncHealth = { pending: 0, synced: 0, failed: 0 };
    for (const r of rows) {
      if (r.ehr_sync_status === "PENDING") result.pending = Number(r.count);
      if (r.ehr_sync_status === "SYNCED") result.synced = Number(r.count);
      if (r.ehr_sync_status === "FAILED") result.failed = Number(r.count);
    }
    return result;
  });
}

export async function listProtocolVersions(ctx: TenantContext) {
  return withTenant(ctx, async (tx) =>
    tx.execute<{ id: string; specialty: string | null; effective_from: string | null }>(
      sql`select id, specialty, effective_from from protocols where hospital_id = ${ctx.hospitalId} order by effective_from desc nulls last`,
    ),
  );
}

export interface ReviewerStat {
  reviewerUserId: string;
  resolvedCount: number;
  medianTimeToResolveSeconds: number | null;
}

/** R2 — "escalations resolved per reviewer, median time to resolve." Uses percentile_cont, not avg — a median is what the spec asks for and avg is skewed by outliers. */
export async function getReviewerStats(ctx: TenantContext): Promise<ReviewerStat[]> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ assigned_to: string; resolved_count: string; median_seconds: string | null }>(sql`
      select
        assigned_to,
        count(*) as resolved_count,
        percentile_cont(0.5) within group (order by time_to_resolve_seconds) as median_seconds
      from escalations
      where hospital_id = ${ctx.hospitalId} and assigned_to is not null and time_to_resolve_seconds is not null
      group by assigned_to
    `);
    return rows.map((r) => ({
      reviewerUserId: r.assigned_to,
      resolvedCount: Number(r.resolved_count),
      medianTimeToResolveSeconds: r.median_seconds !== null ? Number(r.median_seconds) : null,
    }));
  });
}
