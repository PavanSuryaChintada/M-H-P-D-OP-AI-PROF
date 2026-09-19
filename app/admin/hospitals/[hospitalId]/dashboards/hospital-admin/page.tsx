"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import HospitalNav from "../../HospitalNav";

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

  if (error) {
    return (
      <>
        <HospitalNav hospitalId={hospitalId} />
        <main className="page">
          <div className="card alert">Error: {error}</div>
        </main>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <HospitalNav hospitalId={hospitalId} />
        <main className="page">Loading…</main>
      </>
    );
  }

  return (
    <>
      <HospitalNav hospitalId={hospitalId} />
      <main className="page">
        <h1 style={{ marginBottom: "1rem" }}>Hospital Admin dashboard</h1>

        <div className="stat-row">
          <div className="stat">
            <div className="label">Campaigns</div>
            <div className="value">{data.overview.campaignCount}</div>
          </div>
          <div className="stat">
            <div className="label">Outreach volume</div>
            <div className="value">{data.overview.outreachVolume}</div>
          </div>
          <div className="stat">
            <div className="label">Contact rate</div>
            <div className="value">{(data.overview.contactRate * 100).toFixed(0)}%</div>
          </div>
          <div className="stat">
            <div className="label">Avg attempts to contact</div>
            <div className="value">{data.overview.avgAttemptsToContact?.toFixed(1) ?? "n/a"}</div>
          </div>
        </div>

        <section className={data.escalationCounts.overdueCount > 0 ? "card alert" : "card"}>
          <h2>Escalations — {data.escalationCounts.overdueCount} overdue</h2>
          <ul style={{ paddingLeft: "1.25rem" }}>
            {data.escalationCounts.byPriorityAndStatus.map((r) => (
              <li key={`${r.priority}-${r.state}`}>
                Priority {r.priority} · {r.state}: {r.count}
              </li>
            ))}
          </ul>
        </section>

        <div className="stat-row">
          <div className="stat">
            <div className="label">Manual follow-up backlog</div>
            <div className="value">{data.manualFollowUpBacklog}</div>
          </div>
          <div className="stat">
            <div className="label">EHR sync health</div>
            <div style={{ marginTop: "0.35rem" }}>
              Pending {data.ehrSyncHealth.pending} · Synced {data.ehrSyncHealth.synced} ·{" "}
              <span className={data.ehrSyncHealth.failed > 0 ? "badge danger" : "badge"}>Failed {data.ehrSyncHealth.failed}</span>
            </div>
          </div>
        </div>

        <section className="card">
          <h2>Protocols</h2>
          <ul style={{ paddingLeft: "1.25rem" }}>
            {data.protocolVersions.map((p) => (
              <li key={p.id}>
                {p.specialty ?? "general"} — effective {p.effective_from ? new Date(p.effective_from).toLocaleDateString() : "n/a"}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" style={{ padding: 0, paddingTop: "1.25rem" }}>
          <h2 style={{ padding: "0 1.25rem" }}>Reviewer activity</h2>
          <table>
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Resolved</th>
                <th>Median time to resolve</th>
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
    </>
  );
}
