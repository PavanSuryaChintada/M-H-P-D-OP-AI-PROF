import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { listEscalationsForQueue } from "@/lib/db/repositories/escalations";
import type { EscalationState } from "@/lib/escalations/lifecycle";

// Doc 17 R5 — the reviewer work queue. Only CLINICAL_REVIEWER and
// HOSPITAL_ADMIN may open it (escalation:view is narrower than the general
// queue:view — CAMPAIGN_MANAGER sees the call queue but not escalations).
export async function GET(request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "escalation:view");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaignId") ?? undefined;
  const status = (url.searchParams.get("status") as EscalationState | null) ?? undefined;

  const escalations = await listEscalationsForQueue(gate, { campaignId, status });
  return NextResponse.json(escalations);
}
