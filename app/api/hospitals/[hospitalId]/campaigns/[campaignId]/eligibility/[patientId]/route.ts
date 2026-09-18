import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getCampaignById } from "@/lib/db/repositories/campaigns";
import { getEvaluation } from "@/lib/db/repositories/eligibility";
import { evaluatePatientForCampaign } from "@/lib/campaigns/evaluate";

// Doc 05 R5 — "why is patient X not in this campaign?" in one click. Runs a
// fresh evaluation if none exists yet rather than 404ing, so this always
// has an answer.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; campaignId: string; patientId: string }> },
) {
  const { hospitalId, campaignId, patientId } = await params;
  const gate = await guard(hospitalId, "queue:view");
  if (gate instanceof Response) return gate;

  const campaign = await getCampaignById(gate, campaignId);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });

  let evaluation = await getEvaluation(gate, campaignId, patientId);
  if (!evaluation) {
    await evaluatePatientForCampaign(gate, campaign, patientId);
    evaluation = await getEvaluation(gate, campaignId, patientId);
  }

  if (!evaluation) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(evaluation);
}
