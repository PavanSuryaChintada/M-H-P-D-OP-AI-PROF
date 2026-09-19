"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

// Doc 18 R2 — Hospital Admin dashboard. R6: 5s polling.
interface DashboardData {
  overview: { campaignCount: number; outreachVolume: number; contactRate: number; avgAttemptsToContact: number | null };
  escalationCounts: { byPriorityAndStatus: { priority: number; state: string; count: number }[]; overdueCount: number };
  manualFollowUpBacklog: number;
  ehrSyncHealth: { pending: number; synced: number; failed: number };
  protocolVersions: { id: string; specialty: string | null; effective_from: string | null }[];
  reviewerStats: { reviewerUserId: string; resolvedCount: number; medianTimeToResolveSeconds: number | null }[];
}

export default function HospitalAdminDashboard() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/hospitals/${hospitalId}/dashboards/hospital-admin`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `request failed (${res.status})`);
          return;
        }
        setData(await res.json());
        setError(null);
      });
  }, [hospitalId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  if (error) return <main style={{ padding: "2rem" }}>Error: {error}</main>;
  if (!data) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 1000, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Hospital Admin dashboard</h1>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Campaigns</strong>
          <div style={{ fontSize: "2rem" }}>{data.overview.campaignCount}</div>
        </div>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Outreach volume</strong>
          <div style={{ fontSize: "2rem" }}>{data.overview.outreachVolume}</div>
        </div>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Contact rate</strong>
          <div style={{ fontSize: "2rem" }}>{(data.overview.contactRate * 100).toFixed(0)}%</div>
        </div>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Avg attempts to contact</strong>
          <div style={{ fontSize: "2rem" }}>{data.overview.avgAttemptsToContact?.toFixed(1) ?? "n/a"}</div>
        </div>
      </div>

      <section style={{ border: data.escalationCounts.overdueCount > 0 ? "2px solid red" : "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
        <h2>Escalations — {data.escalationCounts.overdueCount} overdue</h2>
        <ul>
          {data.escalationCounts.byPriorityAndStatus.map((r) => (
            <li key={`${r.priority}-${r.state}`}>
              Priority {r.priority} · {r.state}: {r.count}
            </li>
          ))}
        </ul>
      </section>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Manual follow-up backlog</strong>
          <div style={{ fontSize: "2rem" }}>{data.manualFollowUpBacklog}</div>
        </div>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>EHR sync health</strong>
          <div>
            Pending {data.ehrSyncHealth.pending} · Synced {data.ehrSyncHealth.synced} ·{" "}
            <span style={{ color: data.ehrSyncHealth.failed > 0 ? "red" : "inherit" }}>Failed {data.ehrSyncHealth.failed}</span>
          </div>
        </div>
      </div>

      <section style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
        <h2>Protocols</h2>
        <ul>
          {data.protocolVersions.map((p) => (
            <li key={p.id}>
              {p.specialty ?? "general"} — effective {p.effective_from ? new Date(p.effective_from).toLocaleDateString() : "n/a"}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ border: "1px solid #ccc", padding: "1rem" }}>
        <h2>Reviewer activity</h2>
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Reviewer</th>
              <th style={{ textAlign: "left" }}>Resolved</th>
              <th style={{ textAlign: "left" }}>Median time to resolve</th>
            </tr>
          </thead>
          <tbody>
            {data.reviewerStats.map((r) => (
              <tr key={r.reviewerUserId}>
                <td>{r.reviewerUserId}</td>
                <td>{r.resolvedCount}</td>
                <td>{r.medianTimeToResolveSeconds !== null ? `${Math.round(r.medianTimeToResolveSeconds / 60)}m` : "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
