"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

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
  call: "#eef",
  documentation: "#efe",
  escalation: "#fee",
  follow_up_task: "#ffe",
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

  if (error) return <main style={{ padding: "2rem" }}>Error: {error}</main>;
  if (!data) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>
        {data.patient.firstName} {data.patient.lastName} — timeline
      </h1>
      <p>MRN: {data.patient.mrn}</p>

      {data.events.length === 0 ? (
        <p>No recorded activity yet.</p>
      ) : (
        <ol style={{ borderLeft: "2px solid #ccc", paddingLeft: "1rem", listStyle: "none" }}>
          {data.events.map((e, i) => (
            <li key={i} style={{ marginBottom: "1rem", background: TYPE_COLORS[e.type] ?? "#f5f5f5", padding: "0.5rem" }}>
              <div style={{ fontSize: "0.8rem", color: "#666" }}>
                {new Date(e.at).toLocaleString()} — <strong>{e.type}</strong>
              </div>
              <div>{e.summary}</div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
