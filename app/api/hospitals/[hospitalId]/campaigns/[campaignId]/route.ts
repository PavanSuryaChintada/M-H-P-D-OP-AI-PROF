import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getCampaignById, updateCampaignConfig } from "@/lib/db/repositories/campaigns";
import { CreateCampaignSchema } from "@/lib/campaigns/campaign-schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; campaignId: string }> },
) {
  const { hospitalId, campaignId } = await params;
  const gate = await guard(hospitalId, "queue:view");
  if (gate instanceof Response) return gate;

  const campaign = await getCampaignById(gate, campaignId);
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(campaign);
}

// Doc 05 R2 — config updates only while not RUNNING would be safer, but the
// spec doesn't call for locking config during a run, so that's left to the
// caller's judgment for now (a mid-run edit does not retroactively affect
// already-evaluated eligibility rows).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; campaignId: string }> },
) {
  const { hospitalId, campaignId } = await params;
  const gate = await guard(hospitalId, "campaign:manage");
  if (gate instanceof Response) return gate;

  const body = await request.json().catch(() => null);
  const parsed = CreateCampaignSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const { startDate, endDate, ...rest } = parsed.data;
  const campaign = await updateCampaignConfig(gate, campaignId, {
    ...rest,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  });
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(campaign);
}
