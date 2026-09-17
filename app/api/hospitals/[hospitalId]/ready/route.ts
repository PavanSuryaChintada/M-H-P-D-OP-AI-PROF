import { NextRequest, NextResponse } from "next/server";
import { guardPlatformAdmin } from "@/lib/auth/guard";
import { computeReadiness } from "@/lib/hospitals/readiness";
import { updateHospitalStatus } from "@/lib/db/repositories/hospitals";
import { writeAuditLog } from "@/lib/db/repositories/audit";

// POST — attempts to mark the hospital READY. Fails with the same
// named-checklist shape as GET .../readiness if anything is missing,
// rather than a bare 400.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const gate = await guardPlatformAdmin("hospital:configure");
  if (gate instanceof Response) return gate;

  const { hospitalId } = await params;
  let readiness;
  try {
    readiness = await computeReadiness(gate.id, hospitalId);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!readiness.ready) {
    return NextResponse.json({ error: "not ready", missing: readiness.missing }, { status: 400 });
  }

  const hospital = await updateHospitalStatus(hospitalId, "READY");
  await writeAuditLog(
    { hospitalId, userId: gate.id, role: "PLATFORM_ADMIN" },
    { action: "hospital.marked_ready", resourceType: "hospital", resourceId: hospitalId },
  );

  return NextResponse.json(hospital);
}
