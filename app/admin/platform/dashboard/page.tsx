"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// Doc 18 R3 — Platform Admin dashboard. Not hospital-scoped. Aggregates
// only (per-hospital rows here are activity counts, never patient-level
// data) — see lib/analytics/platform-admin.ts for why this never bypasses
// RLS to get them.
interface HospitalActivity {
  hospitalId: string;
  hospitalName: string;
  campaignCount: number;
  activeCalls: number;
  maxConcurrentCalls: number;
  deadLetterEventCount: number;
  stuckTaskCount: number;
}
interface AiUsageStat {
  agent: string;
  callCount: number;
  totalTokens: number;
  estimatedCostUsd: number;
  p95LatencyMs: number | null;
  validationFailureRate: number;
}
interface DashboardData {
  overview: { perHospital: HospitalActivity[]; totals: { campaignCount: number; activeCalls: number; deadLetterEventCount: number; stuckTaskCount: number } };
  aiUsage: AiUsageStat[];
}

export default function PlatformAdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/platform/dashboard`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `request failed (${res.status})`);
          return;
        }
        setData(await res.json());
        setError(null);
      });
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  if (error) return <main className="page"><div className="card alert">Error: {error}</div></main>;
  if (!data) return <main className="page">Loading…</main>;

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <Link href="/" style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
        ← Home
      </Link>
      <h1 style={{ margin: "0.5rem 0 0.25rem" }}>Platform Admin dashboard</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.25rem" }}>Aggregates only — no patient-level data is shown here.</p>

      <div className="stat-row">
        <div className="stat">
          <div className="label">Campaigns (all hospitals)</div>
          <div className="value">{data.overview.totals.campaignCount}</div>
        </div>
        <div className="stat">
          <div className="label">Active calls</div>
          <div className="value">{data.overview.totals.activeCalls}</div>
        </div>
        <div className="stat" style={{ borderColor: data.overview.totals.deadLetterEventCount > 0 ? "var(--danger)" : "var(--border)" }}>
          <div className="label">Dead-letter events</div>
          <div className="value">{data.overview.totals.deadLetterEventCount}</div>
        </div>
        <div className="stat" style={{ borderColor: data.overview.totals.stuckTaskCount > 0 ? "var(--danger)" : "var(--border)" }}>
          <div className="label">Stuck tasks</div>
          <div className="value">{data.overview.totals.stuckTaskCount}</div>
        </div>
      </div>

      <section className="card" style={{ padding: 0, paddingTop: "1.25rem" }}>
        <h2 style={{ padding: "0 1.25rem" }}>Per-hospital activity</h2>
        <table>
          <thead>
            <tr>
              <th>Hospital</th>
              <th>Campaigns</th>
              <th>Capacity</th>
              <th>Dead-letter</th>
              <th>Stuck</th>
            </tr>
          </thead>
          <tbody>
            {data.overview.perHospital.map((h) => (
              <tr key={h.hospitalId}>
                <td>{h.hospitalName}</td>
                <td>{h.campaignCount}</td>
                <td>
                  {h.activeCalls} / {h.maxConcurrentCalls}
                </td>
                <td>{h.deadLetterEventCount}</td>
                <td>{h.stuckTaskCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ padding: 0, paddingTop: "1.25rem" }}>
        <h2 style={{ padding: "0 1.25rem" }}>AI usage by agent</h2>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Calls</th>
              <th>Tokens</th>
              <th>Est. cost</th>
              <th>p95 latency</th>
              <th>Validation failure rate</th>
            </tr>
          </thead>
          <tbody>
            {data.aiUsage.map((a) => (
              <tr key={a.agent}>
                <td>{a.agent}</td>
                <td>{a.callCount}</td>
                <td>{a.totalTokens}</td>
                <td>${a.estimatedCostUsd.toFixed(4)}</td>
                <td>{a.p95LatencyMs !== null ? `${a.p95LatencyMs}ms` : "n/a"}</td>
                <td>{(a.validationFailureRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
