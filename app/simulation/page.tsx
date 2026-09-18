"use client";

import { useEffect, useState } from "react";

interface LiveState {
  tick: number;
  updatedAt?: string;
  notStarted?: boolean;
  capacity?: { active: number; max: number };
  counters?: Record<string, number>;
  recentEvents?: { t: number; tick: number; type: string; [key: string]: unknown }[];
}

/** Doc 08 R4 — polls /api/simulation/live, which reads the JSON file
 * sim/queue-sim.ts writes after every tick. Run `npm run sim` in a
 * separate terminal, then load this page to watch it. */
export default function SimulationPage() {
  const [state, setState] = useState<LiveState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const res = await fetch("/api/simulation/live", { cache: "no-store" });
      if (!cancelled && res.ok) setState(await res.json());
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const capacity = state?.capacity ?? { active: 0, max: 3 };
  const overCapacity = capacity.active > capacity.max;

  return (
    <main style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Queue simulation — live</h1>
      <p style={{ color: "#666" }}>
        Run <code>npm run sim</code> in a terminal to start a run. This page polls its live state
        once per second.
      </p>

      {state?.notStarted ? (
        <p>No simulation run in progress.</p>
      ) : (
        <>
          <section style={{ marginTop: 24 }}>
            <h2>Capacity</h2>
            <p style={{ fontSize: 28, color: overCapacity ? "crimson" : "inherit" }}>
              {capacity.active} / {capacity.max}
              {overCapacity && " — OVER CAPACITY"}
            </p>
            <p>Tick {state?.tick ?? 0}</p>
          </section>

          <section style={{ marginTop: 24 }}>
            <h2>Counters</h2>
            <ul>
              {Object.entries(state?.counters ?? {}).map(([k, v]) => (
                <li key={k}>
                  {k}: <strong>{v}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section style={{ marginTop: 24 }}>
            <h2>Event stream (most recent first)</h2>
            <div style={{ maxHeight: 400, overflowY: "auto", border: "1px solid #ddd", padding: 8 }}>
              {(state?.recentEvents ?? []).map((e, i) => (
                <div key={i} style={{ fontFamily: "monospace", fontSize: 13, padding: "2px 0" }}>
                  [t+{(e.t / 1000).toFixed(1)}s tick={e.tick}] {e.type}{" "}
                  {typeof e.mrn === "string" ? e.mrn : ""} {typeof e.outcome === "string" ? e.outcome : ""}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
