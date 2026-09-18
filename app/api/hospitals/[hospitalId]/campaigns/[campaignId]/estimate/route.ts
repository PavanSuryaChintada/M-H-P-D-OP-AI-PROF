import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getCampaignById } from "@/lib/db/repositories/campaigns";
import { listEvaluationsForCampaign } from "@/lib/db/repositories/eligibility";
import { listEncountersForPatient } from "@/lib/db/repositories/encounters";
import { getHospitalCapacity } from "@/lib/db/repositories/hospital-capacity";
import { computeEstimate } from "@/lib/campaigns/estimate";

// Doc 05 R3 — pre-activation estimate: eligible count, projected attempts,
// projected call-minutes, and a feasibility flag.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; campaignId: string }> },
) {
  const { hospitalId, campaignId } = await params;
  const gate = await guard(hospitalId, "queue:view");
  if (gate instanceof Response) return gate;

  const campaign = await getCampaignById(gate, campaignId);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });

  const eligible = await listEvaluationsForCampaign(gate, campaignId, "ELIGIBLE");
  const capacity = await getHospitalCapacity(gate);

  let hoursRemainingInWindow = 0;
  if (eligible.length > 0) {
    const deadlines = await Promise.all(
      eligible.map(async (e) => {
        const encounters = await listEncountersForPatient(gate, e.patientId);
        const mostRecent = encounters
          .filter((enc) => enc.dischargeAt)
          .sort((a, b) => (b.dischargeAt as Date).getTime() - (a.dischargeAt as Date).getTime())[0];
        if (!mostRecent) return null;
        const windowHours = mostRecent.followUpWindowHours ?? campaign.followUpWindowHours ?? 0;
        return (mostRecent.dischargeAt as Date).getTime() + windowHours * 60 * 60 * 1000;
      }),
    );
    const earliest = Math.min(...deadlines.filter((d): d is number => d != null));
    hoursRemainingInWindow = Math.max(0, (earliest - Date.now()) / (60 * 60 * 1000));
  }

  const estimate = computeEstimate({
    eligibleCount: eligible.length,
    maxAttempts: campaign.maxRetries + 1,
    maxConcurrentCalls: capacity?.maxConcurrentCalls ?? 0,
    hoursRemainingInWindow,
  });

  return NextResponse.json(estimate);
}
