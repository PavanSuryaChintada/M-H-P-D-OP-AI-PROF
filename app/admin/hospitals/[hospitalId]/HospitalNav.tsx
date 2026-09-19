"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Shared navigation for every hospital-scoped admin page. Without this,
// escalations/dashboards/audit/metrics were only reachable by typing the
// URL directly — nothing in the UI linked to them. One component, reused
// everywhere, rather than repeating the same links per page.
const LINKS = (hospitalId: string) => [
  { href: `/admin/hospitals/${hospitalId}`, label: "Overview" },
  { href: `/admin/hospitals/${hospitalId}/patients`, label: "Patients" },
  { href: `/admin/hospitals/${hospitalId}/escalations`, label: "Escalations" },
  { href: `/admin/hospitals/${hospitalId}/dashboards/campaign-manager`, label: "Campaign Dashboard" },
  { href: `/admin/hospitals/${hospitalId}/dashboards/hospital-admin`, label: "Hospital Dashboard" },
  { href: `/admin/hospitals/${hospitalId}/audit`, label: "Audit Log" },
  { href: `/admin/hospitals/${hospitalId}/metrics`, label: "Metrics" },
];

export default function HospitalNav({ hospitalId }: { hospitalId: string }) {
  const pathname = usePathname();
  return (
    <nav className="hospital-nav">
      <Link href="/" className="hospital-nav-home">
        ← All hospitals
      </Link>
      {LINKS(hospitalId).map((link) => (
        <Link key={link.href} href={link.href} className={pathname === link.href ? "hospital-nav-link active" : "hospital-nav-link"}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
