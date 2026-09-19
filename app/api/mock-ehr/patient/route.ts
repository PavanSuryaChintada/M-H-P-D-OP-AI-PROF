import { NextResponse } from "next/server";
import { handleRead } from "../../../../lib/ehr/route-helpers";
import { ehrSystemContext } from "../../../../lib/ehr/system-context";
import { getPatientById } from "../../../../lib/db/repositories/patients";
import { patientToFHIR } from "../../../../lib/ehr/fhir-map";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hospitalId = url.searchParams.get("hospitalId");
  const patientId = url.searchParams.get("patientId");
  if (!hospitalId || !patientId) {
    return NextResponse.json({ error: "hospitalId and patientId are required" }, { status: 400 });
  }

  return handleRead(hospitalId, "getPatient", async () => {
    const row = await getPatientById(ehrSystemContext(hospitalId), patientId);
    return row ? patientToFHIR(row) : null;
  });
}
