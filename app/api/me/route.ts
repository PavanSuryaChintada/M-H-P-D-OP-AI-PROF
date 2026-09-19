import { NextResponse } from "next/server";
import { getCurrentAppUser, listAccessibleHospitals, UnauthenticatedError } from "@/lib/auth/session";

// Not part of any spec doc — added to fix a real gap: the login page sent
// every role straight to /admin/hospitals, which is PLATFORM_ADMIN-only by
// design (doc 01: "Platform Admin cross-hospital aggregate reads are
// explicitly NOT implemented as an RLS bypass" for other roles). A
// HOSPITAL_ADMIN/CAMPAIGN_MANAGER/CLINICAL_REVIEWER got a 403 there and the
// page silently rendered "No hospitals yet." - technically correct
// (they're not allowed to see the full list), but useless as a landing
// page since they do have a real hospital. This tells the client where to
// send them instead.
export async function GET() {
  const appUser = await getCurrentAppUser();
  if (!appUser) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const hospitals = await listAccessibleHospitals().catch((err) => {
    if (err instanceof UnauthenticatedError) return [];
    throw err;
  });

  return NextResponse.json({
    isPlatformAdmin: appUser.isPlatformAdmin,
    hospitals,
  });
}
