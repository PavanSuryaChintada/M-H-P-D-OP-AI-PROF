"use client";

import { useEffect, useState, useCallback } from "react";
import PlatformNav from "../PlatformNav";

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

const STATUS_CLASS: Record<string, string> = { HEALTHY: "badge success", DEGRADED: "badge warn", UNAVAILABLE: "badge danger" };

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

  if (!data) return <><PlatformNav /><main className="page">Loading…</main></>;

  return (
    <>
      <PlatformNav />
      <main className="page" style={{ maxWidth: 800 }}>
      <h1 style={{ margin: "0.5rem 0 1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
        System health <span className={STATUS_CLASS[data.status] ?? "badge"}>{data.status}</span>
      </h1>

      <section className="card">
        <h2>Components</h2>
        <div className="stat-row" style={{ marginBottom: 0 }}>
          {Object.entries(data.components).map(([name, status]) => (
            <div key={name} className="stat" style={{ minWidth: 0 }}>
              <div className="label">{name}</div>
              <span className={STATUS_CLASS[status] ?? "badge"}>{status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Queue</h2>
        <ul style={{ paddingLeft: "1.25rem" }}>
          <li>
            Active calls: {data.queue.active_calls} / {data.queue.capacity}
          </li>
          <li>Pending: {data.queue.pending}</li>
          <li>Oldest pending: {data.queue.oldest_pending_minutes}m</li>
          <li style={{ color: data.queue.cutoff_risk > 0 ? "var(--danger)" : "inherit" }}>Cutoff risk: {data.queue.cutoff_risk}</li>
          <li>Failed: {data.queue.failed}</li>
          <li style={{ color: data.queue.stuck_workers > 0 ? "var(--danger)" : "inherit" }}>Stuck workers: {data.queue.stuck_workers}</li>
        </ul>
      </section>
      </main>
    </>
  );
}
