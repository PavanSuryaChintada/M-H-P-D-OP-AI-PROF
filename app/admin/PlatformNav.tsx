"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Shared navigation across every PLATFORM_ADMIN-scoped page. Each of these
// pages used to carry its own ad-hoc "← Home" link with no way to move
// between them directly - a platform admin landing on the dashboard had no
// way to reach the hospital list, health page, or eval report without
// going back to the homepage first. One persistent bar, same pattern as
// HospitalNav for hospital-scoped roles.
const LINKS = [
  { href: "/admin/platform/dashboard", label: "Dashboard" },
  { href: "/admin/hospitals", label: "Hospitals" },
  { href: "/admin/health", label: "System Health" },
  { href: "/admin/eval", label: "Safety Evaluation" },
];

export default function PlatformNav() {
  const pathname = usePathname();
  return (
    <nav className="hospital-nav">
      <Link href="/" className="hospital-nav-home">
        ← Home
      </Link>
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={pathname === link.href ? "hospital-nav-link active" : "hospital-nav-link"}>
          {link.label}
        </Link>
      ))}
      <span className="badge" style={{ marginLeft: "auto" }}>Platform Admin</span>
    </nav>
  );
}
