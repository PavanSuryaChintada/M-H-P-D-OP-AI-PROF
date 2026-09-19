"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import HospitalNav from "../HospitalNav";

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
    <>
      <HospitalNav hospitalId={hospitalId} />
      <main className="page">
        <h1 style={{ marginBottom: "1rem" }}>Patients</h1>
        {loading ? (
          <p>Loading…</p>
        ) : patients.length === 0 ? (
          <p className="card">No patients ingested yet.</p>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>MRN</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/hospitals/${hospitalId}/patients/${p.id}`}>
                        {p.firstName} {p.lastName}
                      </Link>
                    </td>
                    <td style={{ color: "var(--muted)" }}>{p.mrn}</td>
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
