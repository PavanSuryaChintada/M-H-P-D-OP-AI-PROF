import { NextRequest, NextResponse } from "next/server";
import { guardPlatformAdmin } from "@/lib/auth/guard";
import { getHospitalById, updateHospitalConfig, updateHospitalStatus } from "@/lib/db/repositories/hospitals";
import { upsertHospitalCapacity } from "@/lib/db/repositories/hospital-capacity";
import { writeAuditLog } from "@/lib/db/repositories/audit";
import { HospitalConfigSchema } from "@/lib/hospitals/config-schema";

// PATCH — full replace of hospital_config (doc 03 R2). PLATFORM_ADMIN only.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string }> },
) {
  const gate = await guardPlatformAdmin("hospital:configure");
  if (gate instanceof Response) return gate;

  const { hospitalId } = await params;
  const hospital = await getHospitalById(hospitalId);
  if (!hospital) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = HospitalConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid config", issues: parsed.error.issues }, { status: 400 });
  }

  const before = hospital.config;
  const updated = await updateHospitalConfig(hospitalId, parsed.data);

  const ctx = { hospitalId, userId: gate.id, role: "PLATFORM_ADMIN" as const };
  // Doc 03 acceptance criteria: a capacity change takes effect on the next
  // scheduler tick without a restart — the scheduler (doc 06/07) reads
  // hospital_capacity, so that's what has to change here, not just config.
  await upsertHospitalCapacity(ctx, parsed.data.maxConcurrentCalls);

  if (hospital.status === "CREATED") {
    await updateHospitalStatus(hospitalId, "CONFIGURED");
  }

  await writeAuditLog(ctx, {
    action: "hospital.config_updated",
    resourceType: "hospital",
    resourceId: hospitalId,
    metadata: { before, after: parsed.data },
  });

  return NextResponse.json(updated);
}
