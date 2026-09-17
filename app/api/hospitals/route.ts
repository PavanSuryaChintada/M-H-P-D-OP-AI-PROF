import { NextRequest, NextResponse } from "next/server";
import { guardPlatformAdmin } from "@/lib/auth/guard";
import { createHospital, listHospitals } from "@/lib/db/repositories/hospitals";
import { writeAuditLog } from "@/lib/db/repositories/audit";
import { CreateHospitalSchema } from "@/lib/hospitals/config-schema";

// PLATFORM_ADMIN only — not scoped to any hospital (there isn't one yet).
export async function POST(request: NextRequest) {
  const gate = await guardPlatformAdmin("hospital:create");
  if (gate instanceof Response) return gate;

  const body = await request.json().catch(() => null);
  const parsed = CreateHospitalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const hospital = await createHospital(parsed.data);
  await writeAuditLog(
    { hospitalId: hospital.id, userId: gate.id, role: "PLATFORM_ADMIN" },
    { action: "hospital.created", resourceType: "hospital", resourceId: hospital.id },
  );

  return NextResponse.json(hospital, { status: 201 });
}

export async function GET() {
  const gate = await guardPlatformAdmin("hospital:read");
  if (gate instanceof Response) return gate;

  const hospitalList = await listHospitals();
  return NextResponse.json(hospitalList);
}
