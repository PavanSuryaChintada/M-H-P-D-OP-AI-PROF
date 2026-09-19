"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";

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

  if (error) return <main style={{ padding: "2rem" }}>Error: {error}</main>;
  if (!data) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 1000, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Campaign Manager dashboard</h1>

      {/* R1 — capacity gauge: "the single most important widget in the product" */}
      <section style={{ border: "2px solid #333", padding: "1rem", marginBottom: "1rem" }}>
        <h2>
          Capacity: {data.capacity.active} / {data.capacity.max}
        </h2>
        <div style={{ background: "#eee", height: "1.5rem", width: "100%" }}>
          <div
            style={{
              background: data.capacity.active >= data.capacity.max ? "red" : "green",
              width: `${data.capacity.max > 0 ? Math.min(100, (data.capacity.active / data.capacity.max) * 100) : 0}%`,
              height: "100%",
            }}
          />
        </div>
      </section>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Queue depth</strong>
          <ul>
            {Object.entries(data.queueDepth.byState).map(([state, count]) => (
              <li key={state}>
                {state}: {count}
              </li>
            ))}
          </ul>
          <div>Oldest pending: {data.queueDepth.oldestPendingAgeSeconds !== null ? `${Math.round(data.queueDepth.oldestPendingAgeSeconds / 60)}m` : "n/a"}</div>
        </div>
        <div style={{ border: "2px solid orange", padding: "1rem", flex: 1 }}>
          <strong>Approaching clinical cutoff (Tier 1)</strong>
          <div style={{ fontSize: "2rem" }}>{data.cutoffApproaching}</div>
        </div>
        <div style={{ border: "1px solid #ccc", padding: "1rem", flex: 1 }}>
          <strong>Retry backlog</strong>
          <div style={{ fontSize: "2rem" }}>{data.retryBacklog}</div>
        </div>
      </div>

      {data.progress && (
        <section style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
          <h2>Campaign progress</h2>
          <p>
            Eligible {data.progress.eligible} · Attempted {data.progress.attempted} · Completed {data.progress.completed} ·
            Escalated {data.progress.escalated} · Manual {data.progress.manual} · Failed {data.progress.failed}
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => transition("RUNNING")}>Start / Resume</button>
            <button onClick={() => transition("PAUSED")}>Pause</button>
            <button onClick={() => transition("CANCELLED")}>Cancel</button>
          </div>
        </section>
      )}

      <section style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
        <h2>Callback schedule (next 4 hours)</h2>
        {data.upcomingCallbacks.length === 0 ? (
          <p>None scheduled.</p>
        ) : (
          <ul>
            {data.upcomingCallbacks.map((c) => (
              <li key={c.taskId}>{new Date(c.callbackRequestedAt).toLocaleString()}</li>
            ))}
          </ul>
        )}
      </section>

      {campaignId && (
        <section style={{ border: "1px solid #ccc", padding: "1rem" }}>
          <h2>Live queue</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>State</th>
                <th style={{ textAlign: "left" }}>Tier</th>
                <th style={{ textAlign: "left" }}>Score</th>
                <th style={{ textAlign: "left" }}>Attempts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.queueTable.map((t) => (
                <Fragment key={t.id}>
                  <tr style={{ borderBottom: "1px solid #eee" }}>
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
                      <td colSpan={5} style={{ background: "#f8f8f8", padding: "0.5rem" }}>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(scoreBreakdown, null, 2)}</pre>
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
  );
}
