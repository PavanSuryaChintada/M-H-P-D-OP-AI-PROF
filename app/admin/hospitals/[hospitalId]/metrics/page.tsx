"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import HospitalNav from "../HospitalNav";

// Doc 19 deliverable — internal /admin/metrics view.
interface Metrics {
  queueDepth: { byState: Record<string, number>; oldestPendingAgeSeconds: number | null };
  capacityUtilization: number;
  retryBacklog: number;
  cutoffApproaching: number;
  ehrFailures: number;
  callFailures: number;
  notificationFailures: number;
  stuckTaskCount: number;
}

export default function MetricsPage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const [data, setData] = useState<Metrics | null>(null);

  const load = useCallback(() => {
    fetch(`/api/hospitals/${hospitalId}/metrics`).then(async (res) => setData(await res.json()));
  }, [hospitalId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

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
        <h1 style={{ marginBottom: "1rem" }}>Metrics</h1>

        <div className="stat-row">
          <div className="stat">
            <div className="label">Capacity utilization</div>
            <div className="value">{(data.capacityUtilization * 100).toFixed(0)}%</div>
          </div>
          <div className="stat">
            <div className="label">Retry backlog</div>
            <div className="value">{data.retryBacklog}</div>
          </div>
          <div className="stat">
            <div className="label">Cutoff-approaching</div>
            <div className="value">{data.cutoffApproaching}</div>
          </div>
        </div>
        <div className="stat-row">
          <div className="stat">
            <div className="label">EHR failures</div>
            <div className="value">{data.ehrFailures}</div>
          </div>
          <div className="stat">
            <div className="label">Call failures</div>
            <div className="value">{data.callFailures}</div>
          </div>
          <div className="stat">
            <div className="label">Notification failures</div>
            <div className="value">{data.notificationFailures}</div>
          </div>
          <div className="stat">
            <div className="label">Stuck tasks</div>
            <div className="value">{data.stuckTaskCount}</div>
          </div>
        </div>

        <section className="card">
          <h2>Queue depth by state</h2>
          <p style={{ marginBottom: "0.5rem", color: "var(--muted)" }}>
            Oldest pending: {data.queueDepth.oldestPendingAgeSeconds !== null ? `${Math.round(data.queueDepth.oldestPendingAgeSeconds / 60)}m` : "n/a"}
          </p>
          <ul style={{ paddingLeft: "1.25rem" }}>
            {Object.entries(data.queueDepth.byState).map(([state, count]) => (
              <li key={state}>
                {state}: {count}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
