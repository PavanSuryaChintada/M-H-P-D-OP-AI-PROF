import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { createCampaign, listCampaigns } from "@/lib/db/repositories/campaigns";
import { emitEvent } from "@/lib/db/repositories/events";
import { CreateCampaignSchema } from "@/lib/campaigns/campaign-schema";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "queue:view");
  if (gate instanceof Response) return gate;
  return NextResponse.json(await listCampaigns(gate));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "campaign:manage");
  if (gate instanceof Response) return gate;

  const body = await request.json().catch(() => null);
  const parsed = CreateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const { startDate, endDate, ...rest } = parsed.data;
  const campaign = await createCampaign(gate, {
    ...rest,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  });
  await emitEvent(gate, {
    type: "campaign.created",
    payload: { campaignId: campaign.id },
    idempotencyKey: `campaign.created:${campaign.id}`,
  });
  return NextResponse.json(campaign, { status: 201 });
}
