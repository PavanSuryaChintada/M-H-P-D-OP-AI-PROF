"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

interface Hospital {
  id: string;
  name: string;
  shortCode: string;
  timezone: string;
  status: string;
}

export default function HospitalsPage() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/hospitals");
    if (res.ok) setHospitals(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/hospitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, shortCode, timezone }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `request failed (${res.status})`);
      return;
    }
    setName("");
    setShortCode("");
    setTimezone("");
    load();
  }

  return (
    <main className="page">
      <Link href="/" style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
        ← Home
      </Link>
      <h1 style={{ margin: "0.5rem 0 1rem" }}>Hospitals</h1>

      {loading ? (
        <p>Loading…</p>
      ) : hospitals.length === 0 ? (
        <p className="card">No hospitals yet.</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Short code</th>
                <th>Timezone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {hospitals.map((h) => (
                <tr key={h.id}>
                  <td>
                    <Link href={`/admin/hospitals/${h.id}`}>{h.name}</Link>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{h.shortCode}</td>
                  <td style={{ color: "var(--muted)" }}>{h.timezone}</td>
                  <td>
                    <span className="badge">{h.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card">
        <h2>Create hospital</h2>
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            placeholder="Short code"
            value={shortCode}
            onChange={(e) => setShortCode(e.target.value)}
            required
          />
          <input
            placeholder="IANA timezone, e.g. America/New_York"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            required
          />
          <button type="submit" className="primary">Create</button>
        </form>
        {error && <p style={{ color: "var(--danger)", marginTop: "0.5rem" }}>{error}</p>}
      </section>
    </main>
  );
}
