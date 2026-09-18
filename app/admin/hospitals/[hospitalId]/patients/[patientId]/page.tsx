"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface PatientDetail {
  patient?: { id: string; mrn: string; firstName: string; lastName: string; phone?: string; email?: string };
  id?: string;
  mrn?: string;
  firstName?: string;
  lastName?: string;
  encounters: { id: string; riskLevel: string; followUpWindowHours: number; dischargeAt: string; dischargeInstructions?: string }[];
  conditions?: { id: string; codeText: string }[];
  observations?: { id: string; code: string; value: unknown }[];
  medications?: { id: string; name: string; dosage?: string }[];
  carePlans?: { id: string; title: string; description?: string }[];
}

// Doc 04 deliverable: shows the FHIR-shaped resources for one patient.
// Whether the fields below are populated depends on the viewer's grant
// (doc 02) — a Campaign Manager sees the "limited" shape (name/mrn/
// encounters only), everyone else with access sees the full record.
export default function PatientDetailPage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const patientId = params.patientId as string;
  const [data, setData] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/hospitals/${hospitalId}/patients/${patientId}`)
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

  const name = data.patient
    ? `${data.patient.firstName} ${data.patient.lastName}`
    : `${data.firstName} ${data.lastName}`;
  const mrn = data.patient?.mrn ?? data.mrn;

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>{name}</h1>
      <p>MRN: {mrn}</p>

      <section>
        <h2>Encounters</h2>
        <ul>
          {data.encounters.map((e) => (
            <li key={e.id}>
              Discharged {new Date(e.dischargeAt).toLocaleString()} — risk <strong>{e.riskLevel}</strong> — follow-up
              window {e.followUpWindowHours}h
              {e.dischargeInstructions && <div style={{ color: "#666" }}>{e.dischargeInstructions}</div>}
            </li>
          ))}
        </ul>
      </section>

      {data.conditions && (
        <section>
          <h2>Conditions</h2>
          <ul>
            {data.conditions.map((c) => (
              <li key={c.id}>{c.codeText}</li>
            ))}
          </ul>
        </section>
      )}

      {data.medications && data.medications.length > 0 && (
        <section>
          <h2>Medications</h2>
          <ul>
            {data.medications.map((m) => (
              <li key={m.id}>
                {m.name} {m.dosage ? `(${m.dosage})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.carePlans && data.carePlans.length > 0 && (
        <section>
          <h2>Care plans</h2>
          <ul>
            {data.carePlans.map((cp) => (
              <li key={cp.id}>{cp.title}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
