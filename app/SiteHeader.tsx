import Link from "next/link";

// A persistent top bar for the two pages that sit outside any hospital
// context (landing, login) - HospitalNav plays this role everywhere else.
// Without this, those two pages had no header at all, just a heading
// floating at the top of a narrow column - the biggest single reason the
// app read as "empty" rather than as a real product's front door.
export default function SiteHeader({ tag }: { tag?: string }) {
  return (
    <header className="site-header">
      <Link href="/" className="site-header-brand">
        <span className="site-header-mark" />
        Post-Discharge Outreach
      </Link>
      {tag && <span className="badge">{tag}</span>}
    </header>
  );
}
