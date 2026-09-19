import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getPatientTimeline } from "@/lib/analytics/patient-timeline";

// Doc 18 R4 — patient operational view / timeline.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hospitalId: string; patientId: string }> },
) {
  const { hospitalId, patientId } = await params;
  const gate = await guard(hospitalId, "patient:view_clinical");
  if (gate instanceof Response) return gate;

  const data = await getPatientTimeline(gate, patientId);
  if (!data.patient) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
