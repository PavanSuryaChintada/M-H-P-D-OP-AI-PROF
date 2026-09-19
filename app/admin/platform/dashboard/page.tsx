"use client";

import { useEffect, useState, useCallback } from "react";

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

  if (error) return <main style={{ padding: "2rem" }}>Error: {error}</main>;
  if (!data) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 1100, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Platform Admin dashboard</h1>
      <p style={{ color: "#666" }}>Aggregates only — no patient-level data is shown here.</p>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Campaigns (all hospitals)</strong>
          <div style={{ fontSize: "2rem" }}>{data.overview.totals.campaignCount}</div>
        </div>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Active calls</strong>
          <div style={{ fontSize: "2rem" }}>{data.overview.totals.activeCalls}</div>
        </div>
        <div style={{ border: data.overview.totals.deadLetterEventCount > 0 ? "2px solid red" : "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Dead-letter events</strong>
          <div style={{ fontSize: "2rem" }}>{data.overview.totals.deadLetterEventCount}</div>
        </div>
        <div style={{ border: data.overview.totals.stuckTaskCount > 0 ? "2px solid red" : "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Stuck tasks</strong>
          <div style={{ fontSize: "2rem" }}>{data.overview.totals.stuckTaskCount}</div>
        </div>
      </div>

      <section style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
        <h2>Per-hospital activity</h2>
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Hospital</th>
              <th style={{ textAlign: "left" }}>Campaigns</th>
              <th style={{ textAlign: "left" }}>Capacity</th>
              <th style={{ textAlign: "left" }}>Dead-letter</th>
              <th style={{ textAlign: "left" }}>Stuck</th>
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

      <section style={{ border: "1px solid #ccc", padding: "1rem" }}>
        <h2>AI usage by agent</h2>
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Agent</th>
              <th style={{ textAlign: "left" }}>Calls</th>
              <th style={{ textAlign: "left" }}>Tokens</th>
              <th style={{ textAlign: "left" }}>Est. cost</th>
              <th style={{ textAlign: "left" }}>p95 latency</th>
              <th style={{ textAlign: "left" }}>Validation failure rate</th>
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
