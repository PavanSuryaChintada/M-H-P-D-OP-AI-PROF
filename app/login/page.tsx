"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Doc 23 R3 — demo credentials shown directly on the login page, not just
// in the README, so an evaluator can log in without leaving the browser.
const DEMO_ACCOUNTS = [
  { role: "Platform Admin", email: "platform-admin@demo.mhpd.local" },
  { role: "Hospital Admin", email: "hospital-admin@demo.mhpd.local" },
  { role: "Campaign Manager", email: "campaign-manager@demo.mhpd.local" },
  { role: "Clinical Reviewer", email: "clinical-reviewer@demo.mhpd.local" },
];
const DEMO_PASSWORD = "Demo1234!";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setSubmitting(false);
      setError(signInError.message);
      return;
    }

    // Every other role has exactly one real hospital in this demo; send
    // them straight there instead of the plain hospital list (which is
    // PLATFORM_ADMIN-only anyway - see app/api/hospitals/route.ts - and
    // 403s for everyone else).
    try {
      const res = await fetch("/api/me");
      const me = res.ok ? await res.json() : null;
      if (me && !me.isPlatformAdmin && me.hospitals?.length === 1) {
        router.push(`/admin/hospitals/${me.hospitals[0].hospitalId}`);
        return;
      }
      // Platform Admin's real landing page is the cross-hospital analytics
      // dashboard, not the bare CRUD list of hospitals - that list has no
      // charts, no AI usage, no queue health, just a table. The dashboard
      // links to the list for anyone who needs to open a specific hospital.
      if (me?.isPlatformAdmin) {
        router.push("/admin/platform/dashboard");
        return;
      }
    } catch {
      // Fall through to the default destination below.
    }
    setSubmitting(false);
    router.push("/admin/hospitals");
  }

  return (
    <main className="page" style={{ maxWidth: 420, marginTop: "3rem" }}>
      <h1 style={{ marginBottom: "1.25rem" }}>Sign in</h1>
      <form onSubmit={handleSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && (
        <div className="card alert" style={{ marginTop: "1rem" }}>
          {error}
        </div>
      )}

      <section className="card">
        <h2>Demo accounts</h2>
        <p style={{ color: "var(--muted)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
          Seed data is public and synthetic — not real patient data. Password for all four:{" "}
          <code style={{ background: "var(--background)", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>{DEMO_PASSWORD}</code>
        </p>
        <table>
          <tbody>
            {DEMO_ACCOUNTS.map((a) => (
              <tr key={a.email}>
                <td style={{ fontWeight: 500 }}>{a.role}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    style={{ fontSize: "0.8rem" }}
                  >
                    {a.email}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
