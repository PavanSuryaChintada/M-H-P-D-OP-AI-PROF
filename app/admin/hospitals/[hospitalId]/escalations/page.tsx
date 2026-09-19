"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// Doc 17 R5 — reviewer work queue: OVERDUE pinned top, then priority desc,
// then age asc (the API already returns it in this order — this page just
// renders it and adds a status filter).
interface QueueEscalation {
  id: string;
  patientId: string;
  triggerReason: string;
  priority: number;
  state: string;
  createdAt: string;
}

const STATUS_FILTERS = ["ALL", "OPEN", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_INFORMATION", "OVERDUE"];

function ageLabel(createdAt: string) {
  const minutes = Math.round((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export default function EscalationQueuePage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const [escalations, setEscalations] = useState<QueueEscalation[]>([]);
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const query = status === "ALL" ? "" : `?status=${status}`;
    fetch(`/api/hospitals/${hospitalId}/escalations${query}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `request failed (${res.status})`);
          return;
        }
        setEscalations(await res.json());
        setError(null);
      })
      .finally(() => setLoading(false));
  }, [hospitalId, status]);

  return (
    <main style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Escalation queue</h1>

      <div style={{ marginBottom: "1rem" }}>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              marginRight: "0.5rem",
              fontWeight: status === s ? "bold" : "normal",
              border: "1px solid #ccc",
              padding: "0.25rem 0.5rem",
              background: status === s ? "#eee" : "white",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : escalations.length === 0 ? (
        <p>No escalations{status !== "ALL" ? ` with status ${status}` : ""}.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th style={{ padding: "0.5rem" }}>Status</th>
              <th style={{ padding: "0.5rem" }}>Priority</th>
              <th style={{ padding: "0.5rem" }}>Trigger</th>
              <th style={{ padding: "0.5rem" }}>Age</th>
              <th style={{ padding: "0.5rem" }} />
            </tr>
          </thead>
          <tbody>
            {escalations.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #eee", background: e.state === "OVERDUE" ? "#fee" : "white" }}>
                <td style={{ padding: "0.5rem", fontWeight: e.state === "OVERDUE" ? "bold" : "normal" }}>{e.state}</td>
                <td style={{ padding: "0.5rem" }}>{e.priority}</td>
                <td style={{ padding: "0.5rem" }}>{e.triggerReason}</td>
                <td style={{ padding: "0.5rem" }}>{ageLabel(e.createdAt)}</td>
                <td style={{ padding: "0.5rem" }}>
                  <Link href={`/admin/hospitals/${hospitalId}/escalations/${e.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
