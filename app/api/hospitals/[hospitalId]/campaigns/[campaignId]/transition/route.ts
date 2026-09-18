import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { transitionCampaign } from "@/lib/campaigns/transition";
import { InvalidTransitionError } from "@/lib/campaigns/lifecycle";
import { TransitionSchema } from "@/lib/campaigns/campaign-schema";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; campaignId: string }> },
) {
  const { hospitalId, campaignId } = await params;
  const gate = await guard(hospitalId, "campaign:manage");
  if (gate instanceof Response) return gate;

  const body = await request.json().catch(() => null);
  const parsed = TransitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const campaign = await transitionCampaign(gate, campaignId, parsed.data.to, parsed.data.reason);
    return NextResponse.json(campaign);
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error && err.message === "campaign not found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }
}
