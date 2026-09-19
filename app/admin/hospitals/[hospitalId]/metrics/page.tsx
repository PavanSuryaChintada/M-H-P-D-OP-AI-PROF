"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

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

  if (!data) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Metrics</h1>
      <ul>
        <li>Capacity utilization: {(data.capacityUtilization * 100).toFixed(0)}%</li>
        <li>Retry backlog: {data.retryBacklog}</li>
        <li>Cutoff-approaching (Tier 1): {data.cutoffApproaching}</li>
        <li>EHR failures: {data.ehrFailures}</li>
        <li>Call failures: {data.callFailures}</li>
        <li>Notification failures: {data.notificationFailures}</li>
        <li>Stuck tasks: {data.stuckTaskCount}</li>
        <li>Oldest pending: {data.queueDepth.oldestPendingAgeSeconds !== null ? `${Math.round(data.queueDepth.oldestPendingAgeSeconds / 60)}m` : "n/a"}</li>
      </ul>
      <h2>Queue depth by state</h2>
      <ul>
        {Object.entries(data.queueDepth.byState).map(([state, count]) => (
          <li key={state}>
            {state}: {count}
          </li>
        ))}
      </ul>
    </main>
  );
}
