"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface PatientSummary {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
}

export default function PatientsListPage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/hospitals/${hospitalId}/patients`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setPatients(data);
        setLoading(false);
      });
  }, [hospitalId]);

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Patients</h1>
      {loading ? (
        <p>Loading…</p>
      ) : patients.length === 0 ? (
        <p>No patients ingested yet.</p>
      ) : (
        <ul>
          {patients.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/hospitals/${hospitalId}/patients/${p.id}`}>
                {p.firstName} {p.lastName}
              </Link>{" "}
              — {p.mrn}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
