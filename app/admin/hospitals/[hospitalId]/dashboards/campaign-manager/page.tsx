"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import HospitalNav from "../../HospitalNav";

// Doc 18 R1 — Campaign Manager dashboard. R6: 5s polling, no websockets.
interface QueueTask {
  id: string;
  patientId: string;
  state: string;
  tier: number;
  priorityScore: string;
  attemptCount: number;
}
interface DashboardData {
  capacity: { active: number; max: number };
  queueDepth: { byState: Record<string, number>; oldestPendingAgeSeconds: number | null };
  cutoffApproaching: number;
  retryBacklog: number;
  upcomingCallbacks: { taskId: string; patientId: string; callbackRequestedAt: string }[];
  progress: { eligible: number; attempted: number; completed: number; escalated: number; manual: number; failed: number } | null;
  queueTable: QueueTask[];
}
interface ScoreBreakdown {
  score: number;
  tier: number;
  inputs: Record<string, unknown>;
  [key: string]: unknown;
}

export default function CampaignManagerDashboard() {
  const params = useParams();
  const searchParams = useSearchParams();
  const hospitalId = params.hospitalId as string;
  const campaignId = searchParams.get("campaignId") ?? "";
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scoreFor, setScoreFor] = useState<string | null>(null);
  const [scoreBreakdown, setScoreBreakdown] = useState<ScoreBreakdown | null>(null);

  const load = useCallback(() => {
    const query = campaignId ? `?campaignId=${campaignId}` : "";
    fetch(`/api/hospitals/${hospitalId}/dashboards/campaign-manager${query}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `request failed (${res.status})`);
          return;
        }
        setData(await res.json());
        setError(null);
      });
  }, [hospitalId, campaignId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000); // R6 — 5s polling, no websockets
    return () => clearInterval(interval);
  }, [load]);

  async function transition(to: string) {
    if (!campaignId) return;
    await fetch(`/api/hospitals/${hospitalId}/campaigns/${campaignId}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, reason: `dashboard: ${to.toLowerCase()}` }),
    });
    load();
  }

  async function showScore(taskId: string) {
    setScoreFor(taskId);
    const res = await fetch(`/api/hospitals/${hospitalId}/tasks/${taskId}/score`);
    setScoreBreakdown(res.ok ? await res.json() : null);
  }

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

  const capacityPct = data.capacity.max > 0 ? Math.min(100, (data.capacity.active / data.capacity.max) * 100) : 0;

  return (
    <>
      <HospitalNav hospitalId={hospitalId} />
      <main className="page">
        <h1 style={{ marginBottom: "1rem" }}>Campaign Manager dashboard</h1>

        {/* R1 — capacity gauge: "the single most important widget in the product" */}
        <section className="card" style={{ borderWidth: "2px", borderColor: capacityPct >= 100 ? "var(--danger)" : "var(--primary)" }}>
          <h2>
            Capacity: {data.capacity.active} / {data.capacity.max}
          </h2>
          <div style={{ background: "var(--border)", height: "0.9rem", width: "100%", borderRadius: "999px", overflow: "hidden" }}>
            <div
              style={{
                background: capacityPct >= 100 ? "var(--danger)" : "var(--success)",
                width: `${capacityPct}%`,
                height: "100%",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </section>

        <div className="stat-row">
          <div className="stat">
            <div className="label">Queue depth</div>
            {Object.entries(data.queueDepth.byState).map(([state, count]) => (
              <div key={state} style={{ fontSize: "0.85rem" }}>
                {state}: {count}
              </div>
            ))}
            <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.35rem" }}>
              Oldest pending: {data.queueDepth.oldestPendingAgeSeconds !== null ? `${Math.round(data.queueDepth.oldestPendingAgeSeconds / 60)}m` : "n/a"}
            </div>
          </div>
          <div className="stat" style={{ borderColor: data.cutoffApproaching > 0 ? "var(--warning)" : "var(--border)" }}>
            <div className="label">Approaching clinical cutoff (Tier 1)</div>
            <div className="value">{data.cutoffApproaching}</div>
          </div>
          <div className="stat">
            <div className="label">Retry backlog</div>
            <div className="value">{data.retryBacklog}</div>
          </div>
        </div>

        {data.progress && (
          <section className="card">
            <h2>Campaign progress</h2>
            <p style={{ marginBottom: "0.75rem" }}>
              Eligible {data.progress.eligible} · Attempted {data.progress.attempted} · Completed {data.progress.completed} ·
              Escalated {data.progress.escalated} · Manual {data.progress.manual} · Failed {data.progress.failed}
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="primary" onClick={() => transition("RUNNING")}>Start / Resume</button>
              <button onClick={() => transition("PAUSED")}>Pause</button>
              <button onClick={() => transition("CANCELLED")}>Cancel</button>
            </div>
          </section>
        )}

        <section className="card">
          <h2>Callback schedule (next 4 hours)</h2>
          {data.upcomingCallbacks.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>None scheduled.</p>
          ) : (
            <ul style={{ paddingLeft: "1.25rem" }}>
              {data.upcomingCallbacks.map((c) => (
                <li key={c.taskId}>{new Date(c.callbackRequestedAt).toLocaleString()}</li>
              ))}
            </ul>
          )}
        </section>

        {campaignId && (
          <section className="card" style={{ padding: 0, paddingTop: "1.25rem" }}>
            <h2 style={{ padding: "0 1.25rem" }}>Live queue</h2>
            <table>
              <thead>
                <tr>
                  <th>State</th>
                  <th>Tier</th>
                  <th>Score</th>
                  <th>Attempts</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.queueTable.map((t) => (
                  <Fragment key={t.id}>
                    <tr>
                      <td>{t.state}</td>
                      <td>{t.tier}</td>
                      <td>{Number(t.priorityScore).toFixed(2)}</td>
                      <td>{t.attemptCount}</td>
                      <td>
                        <button onClick={() => showScore(t.id)}>Why this order?</button>
                      </td>
                    </tr>
                    {scoreFor === t.id && scoreBreakdown && (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--background)" }}>
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>{JSON.stringify(scoreBreakdown, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </>
  );
}
