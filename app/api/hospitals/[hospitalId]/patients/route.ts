import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { listPatients } from "@/lib/db/repositories/patients";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "patient:view_clinical");
  if (gate instanceof Response) return gate;

  const patients = await listPatients(gate);
  return NextResponse.json(
    patients.map((p) => ({ id: p.id, mrn: p.mrn, firstName: p.firstName, lastName: p.lastName })),
  );
}
