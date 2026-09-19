import Link from "next/link";

// Doc 23 R6 — a real landing page. Every other page in this app is
// reachable from here; nothing is a URL you have to already know.
export default function Home() {
  return (
    <main className="page" style={{ maxWidth: 720, marginTop: "2rem" }}>
      <h1 style={{ marginBottom: "0.35rem" }}>Multi-Hospital Post-Discharge Outreach Platform</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
        AI-powered patient follow-up, clinical triage, and hospital outreach operations.
      </p>

      <section className="card">
        <h2>Get started</h2>
        <nav className="landing-nav">
          <Link href="/login" className="btn primary">Sign in</Link>
          <Link href="/admin/hospitals" className="btn">Hospitals</Link>
          <Link href="/admin/platform/dashboard" className="btn">Platform Admin dashboard</Link>
        </nav>
      </section>

      <section className="card">
        <h2>System</h2>
        <nav className="landing-nav">
          <Link href="/admin/health" className="btn">System health</Link>
          <Link href="/admin/eval" className="btn">Safety evaluation report</Link>
        </nav>
      </section>

      <section className="card">
        <h2>Broke something exploring the demo?</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          Ask whoever runs the deployment to run <code style={{ background: "var(--background)", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>npm run demo:reset</code>{" "}
          — it truncates operational data (patients, campaigns, calls, escalations) and re-seeds
          demo hospitals, users, and protocols to a known state. It runs against the database&rsquo;s
          admin connection rather than a button in this page, deliberately: the app&rsquo;s own runtime
          connection has no delete permission at all (see <code>lib/db/rls.sql</code>), and that&rsquo;s
          a security property worth keeping rather than weakening for a self-service button.
        </p>
      </section>

      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        See the README for the full setup, demo credentials, and a link to every design document.
      </p>
    </main>
  );
}
