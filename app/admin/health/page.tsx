"use client";

import { useEffect, useState, useCallback } from "react";

// Doc 19 R6 — "put it on screen too."
interface SystemHealth {
  status: string;
  components: Record<string, string>;
  queue: {
    active_calls: number;
    capacity: number;
    pending: number;
    oldest_pending_minutes: number;
    cutoff_risk: number;
    failed: number;
    stuck_workers: number;
  };
}

const STATUS_COLOR: Record<string, string> = { HEALTHY: "green", DEGRADED: "orange", UNAVAILABLE: "red" };

export default function SystemHealthPage() {
  const [data, setData] = useState<SystemHealth | null>(null);

  const load = useCallback(() => {
    fetch("/api/health").then(async (res) => setData(await res.json()));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  if (!data) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>
        System health: <span style={{ color: STATUS_COLOR[data.status] }}>{data.status}</span>
      </h1>

      <section style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
        <h2>Components</h2>
        <ul>
          {Object.entries(data.components).map(([name, status]) => (
            <li key={name} style={{ color: STATUS_COLOR[status] }}>
              {name}: {status}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ border: "1px solid #ccc", padding: "1rem" }}>
        <h2>Queue</h2>
        <ul>
          <li>
            Active calls: {data.queue.active_calls} / {data.queue.capacity}
          </li>
          <li>Pending: {data.queue.pending}</li>
          <li>Oldest pending: {data.queue.oldest_pending_minutes}m</li>
          <li style={{ color: data.queue.cutoff_risk > 0 ? "red" : "inherit" }}>Cutoff risk: {data.queue.cutoff_risk}</li>
          <li>Failed: {data.queue.failed}</li>
          <li style={{ color: data.queue.stuck_workers > 0 ? "red" : "inherit" }}>Stuck workers: {data.queue.stuck_workers}</li>
        </ul>
      </section>
    </main>
  );
}
