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
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Hospitals</h1>

      {loading ? (
        <p>Loading…</p>
      ) : hospitals.length === 0 ? (
        <p>No hospitals yet.</p>
      ) : (
        <ul>
          {hospitals.map((h) => (
            <li key={h.id}>
              <Link href={`/admin/hospitals/${h.id}`}>{h.name}</Link> — {h.shortCode} — {h.timezone} —{" "}
              <strong>{h.status}</strong>
            </li>
          ))}
        </ul>
      )}

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
        <button type="submit">Create</button>
      </form>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </main>
  );
}
