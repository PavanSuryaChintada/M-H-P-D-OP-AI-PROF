import { NextResponse } from "next/server";
import { handleRead } from "../../../../lib/ehr/route-helpers";
import { ehrSystemContext } from "../../../../lib/ehr/system-context";
import { listConditionsForPatient } from "../../../../lib/db/repositories/clinical";
import { conditionToFHIR } from "../../../../lib/ehr/fhir-map";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hospitalId = url.searchParams.get("hospitalId");
  const patientId = url.searchParams.get("patientId");
  if (!hospitalId || !patientId) {
    return NextResponse.json({ error: "hospitalId and patientId are required" }, { status: 400 });
  }

  return handleRead(hospitalId, async () => {
    const rows = await listConditionsForPatient(ehrSystemContext(hospitalId), patientId);
    return rows.map(conditionToFHIR);
  });
}
