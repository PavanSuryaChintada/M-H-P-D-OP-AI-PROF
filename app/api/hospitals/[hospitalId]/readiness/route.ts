import { NextRequest, NextResponse } from "next/server";
import { guardPlatformAdmin } from "@/lib/auth/guard";
import { computeReadiness } from "@/lib/hospitals/readiness";

// Doc 03 R5 acceptance criteria: the checklist names exactly what's missing,
// never a silent failure.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const gate = await guardPlatformAdmin("hospital:configure");
  if (gate instanceof Response) return gate;

  const { hospitalId } = await params;
  try {
    const result = await computeReadiness(gate.id, hospitalId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
