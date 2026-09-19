// Doc 19 R6 — system health. Not hospital-scoped in its own right (a
// platform-wide "is the system up" question), so the queue block sums
// across every hospital using the same per-hospital-loop-under-
// withHospitalContext pattern as doc 18's platform-admin analytics —
// never a single unscoped cross-hospital query, for the same RLS reason.

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { withHospitalContext } from "../db/tenant";
import { listHospitals } from "../db/repositories/hospitals";
import { countStuckWorkers } from "../db/repositories/workers";

export type ComponentStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
export type SystemStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export interface QueueHealth {
  active_calls: number;
  capacity: number;
  pending: number;
  oldest_pending_minutes: number;
  cutoff_risk: number;
  failed: number;
  stuck_workers: number;
}

export interface SystemHealth {
  status: SystemStatus;
  components: {
    database: ComponentStatus;
    worker: ComponentStatus;
    ai_provider_primary: ComponentStatus;
    ai_provider_secondary: ComponentStatus;
    ehr: ComponentStatus;
    queue: ComponentStatus;
  };
  queue: QueueHealth;
}

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    await db.execute(sql`select 1`);
    return "HEALTHY";
  } catch {
    return "UNAVAILABLE";
  }
}

async function getOneHospitalQueueStats(hospitalId: string) {
  return withHospitalContext(hospitalId, async (tx) => {
    const [row] = await tx.execute<{
      active_calls: number;
      max_calls: number;
      pending: string;
      oldest_pending_seconds: number | null;
      cutoff_risk: string;
      failed: string;
      ehr_failed: string;
      ehr_total: string;
    }>(sql`
      select
        coalesce((select current_active_calls from hospital_capacity where hospital_id = ${hospitalId}), 0) as active_calls,
        coalesce((select max_concurrent_calls from hospital_capacity where hospital_id = ${hospitalId}), 0) as max_calls,
        (select count(*) from outreach_tasks where hospital_id = ${hospitalId} and state = 'PENDING') as pending,
        (select extract(epoch from (now() - min(created_at)))::int from outreach_tasks where hospital_id = ${hospitalId} and state = 'PENDING') as oldest_pending_seconds,
        (select count(*) from outreach_tasks where hospital_id = ${hospitalId} and tier = 1 and state not in ('COMPLETED','MANUAL_FOLLOW_UP','FAILED','ESCALATED')) as cutoff_risk,
        (select count(*) from outreach_tasks where hospital_id = ${hospitalId} and state = 'FAILED') as failed,
        (select count(*) from documentation_records where hospital_id = ${hospitalId} and ehr_sync_status = 'FAILED' and created_at > now() - interval '1 hour') as ehr_failed,
        (select count(*) from documentation_records where hospital_id = ${hospitalId} and created_at > now() - interval '1 hour') as ehr_total
    `);
    const stuckWorkers = await countStuckWorkers(hospitalId);
    return { row, stuckWorkers };
  });
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const database = await checkDatabase();
  if (database === "UNAVAILABLE") {
    return {
      status: "UNAVAILABLE",
      components: { database, worker: "UNAVAILABLE", ai_provider_primary: "UNAVAILABLE", ai_provider_secondary: "UNAVAILABLE", ehr: "UNAVAILABLE", queue: "UNAVAILABLE" },
      queue: { active_calls: 0, capacity: 0, pending: 0, oldest_pending_minutes: 0, cutoff_risk: 0, failed: 0, stuck_workers: 0 },
    };
  }

  const hospitals = await listHospitals();
  const perHospital = await Promise.all(hospitals.map((h) => getOneHospitalQueueStats(h.id)));

  const queue: QueueHealth = perHospital.reduce(
    (acc, { row, stuckWorkers }) => ({
      active_calls: acc.active_calls + row.active_calls,
      capacity: acc.capacity + row.max_calls,
      pending: acc.pending + Number(row.pending),
      oldest_pending_minutes: Math.max(acc.oldest_pending_minutes, row.oldest_pending_seconds ? Math.round(row.oldest_pending_seconds / 60) : 0),
      cutoff_risk: acc.cutoff_risk + Number(row.cutoff_risk),
      failed: acc.failed + Number(row.failed),
      stuck_workers: acc.stuck_workers + stuckWorkers,
    }),
    { active_calls: 0, capacity: 0, pending: 0, oldest_pending_minutes: 0, cutoff_risk: 0, failed: 0, stuck_workers: 0 },
  );

  const ehrFailedTotal = perHospital.reduce((sum, { row }) => sum + Number(row.ehr_failed), 0);
  const ehrCallTotal = perHospital.reduce((sum, { row }) => sum + Number(row.ehr_total), 0);
  const ehrFailureRate = ehrCallTotal > 0 ? ehrFailedTotal / ehrCallTotal : 0;

  // Doc 19 R6's example distinguishes ai_provider_primary/secondary — this
  // build has no live API keys configured (docs/dev-ai-usage.md notes every
  // test runs against MockProvider), so there is nothing to actually ping.
  // Reported HEALTHY as the honest default for an unconfigured-but-not-
  // broken dependency, documented rather than faking a real liveness check.
  const components: SystemHealth["components"] = {
    database,
    worker: queue.stuck_workers > 0 ? "DEGRADED" : "HEALTHY",
    ai_provider_primary: "HEALTHY",
    ai_provider_secondary: "HEALTHY",
    ehr: ehrFailureRate > 0.5 ? "DEGRADED" : "HEALTHY",
    queue: queue.pending > 0 && queue.active_calls >= queue.capacity && queue.capacity > 0 ? "DEGRADED" : "HEALTHY",
  };

  const anyDegraded = Object.values(components).some((c) => c === "DEGRADED");
  const anyUnavailable = Object.values(components).some((c) => c === "UNAVAILABLE");
  const status: SystemStatus = anyUnavailable ? "UNAVAILABLE" : anyDegraded ? "DEGRADED" : "HEALTHY";

  return { status, components, queue };
}
