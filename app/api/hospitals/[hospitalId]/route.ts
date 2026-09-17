import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getHospitalById } from "@/lib/db/repositories/hospitals";

// Any role that holds a user_hospital_roles row for this hospital. Doc 02
// acceptance criteria, demonstrated by this route: no session → 401; wrong
// role → 403; no access to this hospital (including one that doesn't exist
// at all) → 404, so a caller can't distinguish the two.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "hospital:read");
  if (gate instanceof Response) return gate;

  const hospital = await getHospitalById(hospitalId);
  if (!hospital) {
    // A user_hospital_roles row pointed at a hospital that's since been
    // deleted — same response as "no access", same reasoning (R2 doc 02).
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(hospital);
}
