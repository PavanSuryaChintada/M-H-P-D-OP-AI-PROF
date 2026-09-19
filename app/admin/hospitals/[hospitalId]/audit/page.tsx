"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import HospitalNav from "../HospitalNav";

// Doc 19 R5 — audit viewer with filters for actor, action type, and date range.
interface AuditRow {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string | null;
  at: string;
}

export default function AuditViewerPage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (actor) q.set("actor", actor);
    if (action) q.set("action", action);
    if (from) q.set("from", new Date(from).toISOString());
    if (to) q.set("to", new Date(to).toISOString());
    fetch(`/api/hospitals/${hospitalId}/audit?${q.toString()}`).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `request failed (${res.status})`);
        return;
      }
      setRows(await res.json());
      setError(null);
    });
  }, [hospitalId, actor, action, from, to]);

  useEffect(() => load(), [load]);

  return (
    <>
      <HospitalNav hospitalId={hospitalId} />
      <main className="page">
        <h1 style={{ marginBottom: "1rem" }}>Audit log</h1>

        <div className="card" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input placeholder="Actor user id" value={actor} onChange={(e) => setActor(e.target.value)} />
          <input placeholder="Action (e.g. escalation.resolved)" value={action} onChange={(e) => setAction(e.target.value)} />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="primary" onClick={load}>Filter</button>
        </div>

        {error && <div className="card alert">{error}</div>}
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>At</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ color: "var(--muted)" }}>{new Date(r.at).toLocaleString()}</td>
                  <td>{r.actorUserId ?? "system"}</td>
                  <td>
                    <span className="badge">{r.action}</span>
                  </td>
                  <td>
                    {r.resourceType} {r.resourceId ?? ""}
                  </td>
                  <td>{r.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
