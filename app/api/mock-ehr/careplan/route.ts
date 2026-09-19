import { NextResponse } from "next/server";
import { handleRead } from "../../../../lib/ehr/route-helpers";
import { ehrSystemContext } from "../../../../lib/ehr/system-context";
import { listCarePlansForPatient } from "../../../../lib/db/repositories/clinical";
import { carePlanToFHIR } from "../../../../lib/ehr/fhir-map";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hospitalId = url.searchParams.get("hospitalId");
  const patientId = url.searchParams.get("patientId");
  if (!hospitalId || !patientId) {
    return NextResponse.json({ error: "hospitalId and patientId are required" }, { status: 400 });
  }

  return handleRead(hospitalId, "getCarePlan", async () => {
    const rows = await listCarePlansForPatient(ehrSystemContext(hospitalId), patientId);
    // Doc 15 R1's getCarePlan is singular — the most recently created plan for this patient.
    const latest = rows[rows.length - 1];
    return latest ? carePlanToFHIR(latest) : null;
  });
}
