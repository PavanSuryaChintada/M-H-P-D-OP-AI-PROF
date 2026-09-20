import Link from "next/link";
import SiteHeader from "./SiteHeader";

// Doc 23 R6 — a real landing page. Every other page in this app is
// reachable from here; nothing is a URL you have to already know.
export default function Home() {
  return (
    <>
      <SiteHeader tag="Demo" />
      <section className="hero">
        <div className="hero-inner">
          <h1>Multi-Hospital Post-Discharge Outreach Platform</h1>
          <p>
            AI-assisted patient follow-up, clinical triage, and human-in-the-loop escalation for
            hospital outreach teams &mdash; running a real, capacity-constrained call queue across
            multiple isolated hospitals.
          </p>
          <div className="fact-strip">
            <div className="fact">
              <span className="value">4</span>
              <span className="label meta">roles, tenant-isolated</span>
            </div>
            <div className="fact">
              <span className="value">3</span>
              <span className="label meta">independent safety assessors</span>
            </div>
            <div className="fact">
              <span className="value">0.00%</span>
              <span className="label meta">measured false-negative rate</span>
            </div>
            <div className="fact">
              <span className="value">225</span>
              <span className="label meta">automated tests</span>
            </div>
          </div>
        </div>
      </section>

      <main className="page wide">
        <div className="card-grid">
          <section className="card">
            <span className="card-icon">&rarr;</span>
            <h2>Get started</h2>
            <nav className="landing-nav">
              <Link href="/login" className="btn primary">Sign in</Link>
              <Link href="/admin/hospitals" className="btn">Hospitals</Link>
              <Link href="/admin/platform/dashboard" className="btn">Platform Admin dashboard</Link>
            </nav>
          </section>

          <section className="card">
            <span className="card-icon">&#8942;</span>
            <h2>System</h2>
            <nav className="landing-nav">
              <Link href="/admin/health" className="btn">System health</Link>
              <Link href="/admin/eval" className="btn">Safety evaluation report</Link>
            </nav>
          </section>

          <section className="card">
            <span className="card-icon">?</span>
            <h2>Broke something exploring the demo?</h2>
            <p className="meta">
              Ask whoever runs the deployment to run <code style={{ background: "var(--sunken)", padding: "0.1rem 0.4rem" }}>npm run demo:reset</code>{" "}
              &mdash; it truncates operational data and re-seeds demo hospitals, users, and protocols to a
              known state. It runs against the database&rsquo;s admin connection rather than a button on
              this page, deliberately: the app&rsquo;s own runtime connection has no delete permission at
              all, and that&rsquo;s a security property worth keeping rather than weakening for a
              self-service button.
            </p>
          </section>
        </div>

        <p className="meta">
          See the README for the full setup, demo credentials, and a link to every design document.
        </p>
      </main>
    </>
  );
}
