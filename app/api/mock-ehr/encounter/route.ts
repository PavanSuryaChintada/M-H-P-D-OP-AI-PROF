import { NextResponse } from "next/server";
import { handleRead } from "../../../../lib/ehr/route-helpers";
import { ehrSystemContext } from "../../../../lib/ehr/system-context";
import { getEncounterById } from "../../../../lib/db/repositories/encounters";
import { encounterToFHIR } from "../../../../lib/ehr/fhir-map";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hospitalId = url.searchParams.get("hospitalId");
  const encounterId = url.searchParams.get("encounterId");
  if (!hospitalId || !encounterId) {
    return NextResponse.json({ error: "hospitalId and encounterId are required" }, { status: 400 });
  }

  return handleRead(hospitalId, async () => {
    const row = await getEncounterById(ehrSystemContext(hospitalId), encounterId);
    return row ? encounterToFHIR(row) : null;
  });
}
