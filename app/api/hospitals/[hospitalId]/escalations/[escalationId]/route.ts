import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

// Stub — actual escalation resolution (doc 17) isn't built yet. This exists
// to exercise the guard chain against the PRD §3 example almost verbatim:
// "a CAMPAIGN_MANAGER token cannot resolve an escalation" (403), only
// CLINICAL_REVIEWER can. escalationId is accepted but unused until doc 17.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; escalationId: string }> },
) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "escalation:resolve");
  if (gate instanceof Response) return gate;

  return NextResponse.json(
    { ok: true, note: "escalation resolution logic lands in doc 17 — this only proves the permission gate" },
    { status: 200 },
  );
}
