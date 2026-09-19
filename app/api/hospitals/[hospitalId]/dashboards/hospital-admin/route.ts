import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import {
  getHospitalOverview,
  getEscalationCounts,
  getManualFollowUpBacklogCount,
  getEhrSyncHealth,
  listProtocolVersions,
  getReviewerStats,
} from "@/lib/analytics/hospital-admin";

// Doc 18 R2 — Hospital Admin dashboard, one round trip.
export async function GET(_request: Request, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "hospital:view_dashboard");
  if (gate instanceof Response) return gate;

  const [overview, escalationCounts, manualFollowUpBacklog, ehrSyncHealth, protocolVersions, reviewerStats] = await Promise.all([
    getHospitalOverview(gate),
    getEscalationCounts(gate),
    getManualFollowUpBacklogCount(gate),
    getEhrSyncHealth(gate),
    listProtocolVersions(gate),
    getReviewerStats(gate),
  ]);

  return NextResponse.json({ overview, escalationCounts, manualFollowUpBacklog, ehrSyncHealth, protocolVersions, reviewerStats });
}
