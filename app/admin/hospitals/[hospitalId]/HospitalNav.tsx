"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Shared navigation for every hospital-scoped admin page. Without this,
// escalations/dashboards/audit/metrics were only reachable by typing the
// URL directly — nothing in the UI linked to them. One component, reused
// everywhere, rather than repeating the same links per page.
//
// Every link used to show for every role, regardless of whether that
// role's own API would actually let them in (a CAMPAIGN_MANAGER got the
// exact same nav as a CLINICAL_REVIEWER, then hit a 403 on Escalations) -
// real per-role differences existed only on the backend, invisible in the
// UI. `nav` (from GET /api/me?hospitalId=) is computed server-side from
// the same permission matrix every route guard already uses, so a link
// only ever appears if that role can actually open it.
const ALL_LINKS = (hospitalId: string) => [
  { href: `/admin/hospitals/${hospitalId}`, label: "Overview", navKey: null },
  { href: `/admin/hospitals/${hospitalId}/patients`, label: "Patients", navKey: "patients" as const },
  { href: `/admin/hospitals/${hospitalId}/escalations`, label: "Escalations", navKey: "escalations" as const },
  { href: `/admin/hospitals/${hospitalId}/dashboards/campaign-manager`, label: "Campaign Dashboard", navKey: "campaignDashboard" as const },
  { href: `/admin/hospitals/${hospitalId}/dashboards/hospital-admin`, label: "Hospital Dashboard", navKey: "hospitalDashboard" as const },
  { href: `/admin/hospitals/${hospitalId}/audit`, label: "Audit Log", navKey: "auditLog" as const },
  { href: `/admin/hospitals/${hospitalId}/metrics`, label: "Metrics", navKey: "metrics" as const },
];

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "Platform Admin",
  HOSPITAL_ADMIN: "Hospital Admin",
  CAMPAIGN_MANAGER: "Campaign Manager",
  CLINICAL_REVIEWER: "Clinical Reviewer",
};

interface NavPermissions {
  patients: boolean | "limited" | "audited";
  escalations: boolean;
  campaignDashboard: boolean;
  hospitalDashboard: boolean;
  auditLog: boolean;
  metrics: boolean;
}

export default function HospitalNav({ hospitalId }: { hospitalId: string }) {
  const pathname = usePathname();
  const [role, setRole] = useState<string | null>(null);
  const [nav, setNav] = useState<NavPermissions | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/me?hospitalId=${hospitalId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (cancelled || !me) return;
        setRole(me.role);
        setNav(me.nav);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hospitalId]);

  // While role/nav are loading, show only Overview (always allowed to
  // every hospital-scoped role) rather than flashing every link and then
  // hiding some a moment later.
  const links = ALL_LINKS(hospitalId).filter((link) => {
    if (link.navKey === null) return true;
    if (!nav) return false;
    return nav[link.navKey] !== false;
  });

  return (
    <nav className="hospital-nav">
      <Link href="/" className="hospital-nav-home">
        ← All hospitals
      </Link>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={pathname === link.href ? "hospital-nav-link active" : "hospital-nav-link"}>
          {link.label}
        </Link>
      ))}
      {role && (
        <span className="badge" style={{ marginLeft: "auto" }}>
          {ROLE_LABELS[role] ?? role}
        </span>
      )}
    </nav>
  );
}
