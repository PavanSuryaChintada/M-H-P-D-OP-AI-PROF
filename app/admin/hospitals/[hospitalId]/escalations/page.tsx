"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import HospitalNav from "../HospitalNav";

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
    <>
      <HospitalNav hospitalId={hospitalId} />
      <main className="page">
        <h1 style={{ marginBottom: "1rem" }}>Escalation queue</h1>

        <div style={{ marginBottom: "1.25rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={status === s ? "primary" : ""}>
              {s}
            </button>
          ))}
        </div>

        {error && <div className="card alert">Error: {error}</div>}
        {loading ? (
          <p>Loading…</p>
        ) : escalations.length === 0 ? (
          <p className="card">No escalations{status !== "ALL" ? ` with status ${status}` : ""}.</p>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Trigger</th>
                  <th>Age</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {escalations.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className={e.state === "OVERDUE" ? "badge danger" : "badge"}>{e.state}</span>
                    </td>
                    <td>{e.priority}</td>
                    <td>{e.triggerReason}</td>
                    <td style={{ color: "var(--muted)" }}>{ageLabel(e.createdAt)}</td>
                    <td>
                      <Link href={`/admin/hospitals/${hospitalId}/escalations/${e.id}`} className="btn">
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
