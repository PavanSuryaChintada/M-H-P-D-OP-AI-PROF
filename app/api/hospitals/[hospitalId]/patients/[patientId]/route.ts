import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import {
  resolveTenantContext,
  resolvePlatformAdminAccess,
  UnauthenticatedError,
  NoHospitalAccessError,
} from "@/lib/auth/session";
import { getPatientById } from "@/lib/db/repositories/patients";
import { listEncountersForPatient } from "@/lib/db/repositories/encounters";
import {
  listConditionsForPatient,
  listObservationsForPatient,
  listMedicationsForPatient,
  listCarePlansForPatient,
} from "@/lib/db/repositories/clinical";
import type { TenantContext } from "@/lib/db/tenant";

// Doc 02 R2's "audited"/"limited" grants, actually applied: a Platform
// Admin needs ?reason= to get in at all (and it's audit-logged by
// resolvePlatformAdminAccess), and a Campaign Manager gets a narrower view
// than Hospital Admin / Clinical Reviewer.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; patientId: string }> },
) {
  const { hospitalId, patientId } = await params;
  const reason = request.nextUrl.searchParams.get("reason");

  let ctx: TenantContext;
  try {
    ctx = reason ? await resolvePlatformAdminAccess(hospitalId, reason) : await resolveTenantContext(hospitalId);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (err instanceof NoHospitalAccessError) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }

  const grant = can(ctx.role, "patient:view_clinical");
  if (grant === false) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const patient = await getPatientById(ctx, patientId);
  if (!patient) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const encounters = await listEncountersForPatient(ctx, patientId);

  if (grant === "limited") {
    // Campaign Manager — demographics + risk/timing for outreach
    // decisions, not the detailed clinical narrative.
    return NextResponse.json({
      id: patient.id,
      mrn: patient.mrn,
      firstName: patient.firstName,
      lastName: patient.lastName,
      encounters: encounters.map((e) => ({
        id: e.id,
        riskLevel: e.riskLevel,
        followUpWindowHours: e.followUpWindowHours,
        dischargeAt: e.dischargeAt,
      })),
    });
  }

  const [conditions, observations, medications, carePlans] = await Promise.all([
    listConditionsForPatient(ctx, patientId),
    listObservationsForPatient(ctx, patientId),
    listMedicationsForPatient(ctx, patientId),
    listCarePlansForPatient(ctx, patientId),
  ]);

  return NextResponse.json({ patient, encounters, conditions, observations, medications, carePlans });
}
