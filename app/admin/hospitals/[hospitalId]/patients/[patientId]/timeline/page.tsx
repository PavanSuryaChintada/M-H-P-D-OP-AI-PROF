"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import HospitalNav from "../../../HospitalNav";

// Doc 18 R4 — "the timeline is the 'what happened to this patient?' answer
// the PRD keeps asking for."
interface TimelineEvent {
  type: string;
  at: string;
  summary: string;
  detail: unknown;
}
interface TimelineData {
  patient: { id: string; firstName: string; lastName: string; mrn: string };
  events: TimelineEvent[];
}

const TYPE_COLORS: Record<string, string> = {
  call: "#2563eb",
  documentation: "#16a34a",
  escalation: "#dc2626",
  follow_up_task: "#d97706",
};

export default function PatientTimelinePage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const patientId = params.patientId as string;
  const [data, setData] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/hospitals/${hospitalId}/dashboards/patient/${patientId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `request failed (${res.status})`);
          return;
        }
        setData(await res.json());
      });
  }, [hospitalId, patientId]);

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

  return (
    <>
      <HospitalNav hospitalId={hospitalId} />
      <main className="page">
        <h1>
          {data.patient.firstName} {data.patient.lastName} — timeline
        </h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.25rem" }}>MRN: {data.patient.mrn}</p>

        {data.events.length === 0 ? (
          <p className="card">No recorded activity yet.</p>
        ) : (
          <ol style={{ borderLeft: "2px solid var(--border)", paddingLeft: "1rem", listStyle: "none" }}>
            {data.events.map((e, i) => (
              <li key={i} className="card" style={{ marginBottom: "0.75rem", borderLeftWidth: "4px", borderLeftColor: TYPE_COLORS[e.type] ?? "var(--border)" }}>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  {new Date(e.at).toLocaleString()} — <strong>{e.type}</strong>
                </div>
                <div>{e.summary}</div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
