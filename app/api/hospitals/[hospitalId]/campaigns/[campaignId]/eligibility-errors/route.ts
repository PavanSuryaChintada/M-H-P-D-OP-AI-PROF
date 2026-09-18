import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { listEligibilityErrors } from "@/lib/db/repositories/eligibility";
import { getCampaignById } from "@/lib/db/repositories/campaigns";
import { evaluatePatientForCampaign } from "@/lib/campaigns/evaluate";
import { z } from "zod";

// Doc 05 R6 — the recovery list for ELIGIBILITY_ERROR, so a rule-engine
// exception never means a patient just silently disappears.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; campaignId: string }> },
) {
  const { hospitalId, campaignId } = await params;
  const gate = await guard(hospitalId, "queue:view");
  if (gate instanceof Response) return gate;
  return NextResponse.json(await listEligibilityErrors(gate, campaignId));
}

const RetrySchema = z.object({ patientId: z.uuid() });

// POST — the recovery list's "retry" action: re-run evaluation for one patient.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; campaignId: string }> },
) {
  const { hospitalId, campaignId } = await params;
  const gate = await guard(hospitalId, "campaign:manage");
  if (gate instanceof Response) return gate;

  const body = await request.json().catch(() => null);
  const parsed = RetrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const campaign = await getCampaignById(gate, campaignId);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await evaluatePatientForCampaign(gate, campaign, parsed.data.patientId);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(result);
}
