import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getQueueDepth, getCapacityGauge, getRetryBacklogCount, getCutoffApproachingCount } from "@/lib/analytics/campaign-manager";
import { getEhrSyncHealth, getOperationalMetrics } from "@/lib/analytics/hospital-admin";

// Doc 19 R3 — application metrics. Reuses doc 18's analytics layer rather
// than standing up a second, parallel metrics pipeline: queue depth,
// capacity utilisation, retry backlog, and EHR health are the same numbers
// the dashboards already compute. What is NOT here: API latency/error rate
// and auth-failure counts — those are emitted as structured log events
// (lib/obs/logger.ts's "auth.denied") rather than aggregated into a
// queryable table, since this build has no metrics store (Prometheus,
// etc.) to aggregate them into; a real deployment would scrape the log
// stream for those two.
export async function GET(_request: Request, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "hospital:view_dashboard");
  if (gate instanceof Response) return gate;

  const [queueDepth, capacity, retryBacklog, cutoffApproaching, ehrSyncHealth, operational] = await Promise.all([
    getQueueDepth(gate),
    getCapacityGauge(gate),
    getRetryBacklogCount(gate),
    getCutoffApproachingCount(gate),
    getEhrSyncHealth(gate),
    getOperationalMetrics(gate),
  ]);

  return NextResponse.json({
    queueDepth,
    capacityUtilization: capacity.max > 0 ? capacity.active / capacity.max : 0,
    retryBacklog,
    cutoffApproaching,
    ehrFailures: ehrSyncHealth.failed,
    callFailures: operational.callFailures,
    notificationFailures: operational.notificationFailures,
    stuckTaskCount: operational.stuckTaskCount,
  });
}
