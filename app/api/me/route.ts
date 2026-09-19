import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, listAccessibleHospitals, UnauthenticatedError } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";

// Not part of any spec doc — added to fix a real gap: the login page sent
// every role straight to /admin/hospitals, which is PLATFORM_ADMIN-only by
// design (doc 01: "Platform Admin cross-hospital aggregate reads are
// explicitly NOT implemented as an RLS bypass" for other roles). A
// HOSPITAL_ADMIN/CAMPAIGN_MANAGER/CLINICAL_REVIEWER got a 403 there and the
// page silently rendered "No hospitals yet." - technically correct
// (they're not allowed to see the full list), but useless as a landing
// page since they do have a real hospital. This tells the client where to
// send them instead.
export async function GET(request: NextRequest) {
  const appUser = await getCurrentAppUser();
  if (!appUser) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const hospitals = await listAccessibleHospitals().catch((err) => {
    if (err instanceof UnauthenticatedError) return [];
    throw err;
  });

  // Optional ?hospitalId= — used by HospitalNav to decide which links to
  // show for the CURRENT viewer's role at THIS hospital, computed from the
  // real permission matrix (lib/auth/permissions.ts) rather than a second,
  // client-side copy of it that could drift out of sync. That matrix isn't
  // safe to import into a client component directly - it pulls in the
  // Role type from lib/db/tenant.ts, which imports the live DB client.
  const hospitalId = request.nextUrl.searchParams.get("hospitalId");
  const match = hospitalId ? hospitals.find((h) => h.hospitalId === hospitalId) : undefined;
  const role = match?.role;

  return NextResponse.json({
    isPlatformAdmin: appUser.isPlatformAdmin,
    hospitals,
    role: role ?? null,
    nav: role
      ? {
          patients: can(role, "patient:view_clinical"),
          escalations: can(role, "escalation:view"),
          campaignDashboard: can(role, "campaign:manage"),
          hospitalDashboard: can(role, "hospital:view_dashboard"),
          auditLog: can(role, "hospital:view_dashboard"),
          metrics: can(role, "hospital:view_dashboard"),
        }
      : null,
  });
}
