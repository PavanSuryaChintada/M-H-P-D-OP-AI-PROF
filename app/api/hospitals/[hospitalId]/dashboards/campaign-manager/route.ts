import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import {
  getCampaignProgress,
  getCapacityGauge,
  getQueueDepth,
  getCutoffApproachingCount,
  getRetryBacklogCount,
  getUpcomingCallbacks,
} from "@/lib/analytics/campaign-manager";
import { listQueueTasksForCampaign } from "@/lib/db/repositories/outreach-tasks";

// Doc 18 R1 — Campaign Manager dashboard, one round trip.
export async function GET(request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "campaign:manage");
  if (gate instanceof Response) return gate;

  const campaignId = new URL(request.url).searchParams.get("campaignId") ?? undefined;

  const [capacity, queueDepth, cutoffApproaching, retryBacklog, upcomingCallbacks, progress, queueTable] = await Promise.all([
    getCapacityGauge(gate),
    getQueueDepth(gate, campaignId),
    getCutoffApproachingCount(gate),
    getRetryBacklogCount(gate),
    getUpcomingCallbacks(gate),
    campaignId ? getCampaignProgress(gate, campaignId) : Promise.resolve(null),
    campaignId ? listQueueTasksForCampaign(gate, campaignId) : Promise.resolve([]),
  ]);

  return NextResponse.json({ capacity, queueDepth, cutoffApproaching, retryBacklog, upcomingCallbacks, progress, queueTable });
}
