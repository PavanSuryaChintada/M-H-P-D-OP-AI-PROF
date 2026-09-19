"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import HospitalNav from "./HospitalNav";

interface Hospital {
  id: string;
  name: string;
  shortCode: string;
  timezone: string;
  status: string;
  config: unknown;
}
interface EscalationContact {
  id: string;
  role: string;
  channel: string;
  contactValue: string;
  ackTimeoutMinutes: number;
}
interface Readiness {
  ready: boolean;
  missing: string[];
}

// Config has ~15 nested fields (per-weekday hours, retry backoff array,
// notification prefs, EHR settings) — a raw JSON editor pre-filled with a
// valid template is the pragmatic prototype choice over building 15+
// individual form controls. lib/hospitals/config-schema.ts is still what
// validates it server-side; this is just how a human edits it.
const DEFAULT_CONFIG_TEMPLATE = JSON.stringify(
  {
    callingHours: {
      MON: { start: "09:00", end: "18:00" },
      TUE: { start: "09:00", end: "18:00" },
      WED: { start: "09:00", end: "18:00" },
      THU: { start: "09:00", end: "18:00" },
      FRI: { start: "09:00", end: "18:00" },
    },
    maxConcurrentCalls: 5,
    defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60, 240], jitterPct: 10 },
    defaultFollowUpWindowHours: 72,
    notificationPreferences: { channels: ["IN_APP", "EMAIL"], reviewerTimeoutMinutes: 30 },
    ehrSettings: { mode: "mock", failureRate: 0.05 },
  },
  null,
  2,
);

export default function HospitalDetailPage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;

  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [configText, setConfigText] = useState(DEFAULT_CONFIG_TEMPLATE);
  const [contacts, setContacts] = useState<EscalationContact[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [contactRole, setContactRole] = useState("");
  const [contactChannel, setContactChannel] = useState("EMAIL");
  const [contactValue, setContactValue] = useState("");
  const [contactTimeout, setContactTimeout] = useState(15);

  async function loadAll() {
    const [hRes, cRes, rRes] = await Promise.all([
      fetch(`/api/hospitals/${hospitalId}`),
      fetch(`/api/hospitals/${hospitalId}/escalation-contacts`),
      fetch(`/api/hospitals/${hospitalId}/readiness`),
    ]);
    if (hRes.ok) {
      const h = await hRes.json();
      setHospital(h);
      if (h.config) setConfigText(JSON.stringify(h.config, null, 2));
    }
    if (cRes.ok) setContacts(await cRes.json());
    if (rRes.ok) setReadiness(await rRes.json());
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId]);

  async function handleSaveConfig(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(configText);
    } catch {
      setError("Invalid JSON");
      return;
    }
    const res = await fetch(`/api/hospitals/${hospitalId}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(JSON.stringify(body.issues ?? body.error ?? `request failed (${res.status})`));
      return;
    }
    loadAll();
  }

  async function handleAddContact(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/hospitals/${hospitalId}/escalation-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderIndex: contacts.length,
        role: contactRole,
        channel: contactChannel,
        contactValue,
        ackTimeoutMinutes: Number(contactTimeout),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `request failed (${res.status})`);
      return;
    }
    setContactRole("");
    setContactValue("");
    loadAll();
  }

  async function handleMarkReady() {
    setError(null);
    const res = await fetch(`/api/hospitals/${hospitalId}/ready`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(`Not ready: ${(body.missing ?? []).join(", ")}`);
      return;
    }
    loadAll();
  }

  if (!hospital) {
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
        <h1 style={{ marginBottom: "0.35rem" }}>{hospital.name}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.25rem" }}>
          {hospital.shortCode} · {hospital.timezone} · status: <strong>{hospital.status}</strong>
        </p>

        {readiness && (
          <section className={readiness.ready ? "card" : "card warn"}>
            <h2>Readiness</h2>
            {readiness.ready ? (
              <p>Ready.</p>
            ) : (
              <ul style={{ paddingLeft: "1.25rem", marginBottom: "0.75rem" }}>
                {readiness.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <button className="primary" onClick={handleMarkReady} disabled={!readiness.ready}>
              Mark READY
            </button>
          </section>
        )}

        <section className="card">
          <h2>Operating configuration</h2>
          <form onSubmit={handleSaveConfig}>
            <textarea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              rows={16}
              style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem", marginBottom: "0.75rem" }}
            />
            <button type="submit" className="primary">Save config</button>
          </form>
        </section>

        <section className="card">
          <h2>Escalation contacts</h2>
          <ul style={{ paddingLeft: "1.25rem", marginBottom: "1rem" }}>
            {contacts.map((c) => (
              <li key={c.id}>
                {c.role} — {c.channel} — {c.contactValue} — ack {c.ackTimeoutMinutes}m
              </li>
            ))}
          </ul>
          <form onSubmit={handleAddContact} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Role (e.g. Charge Nurse)"
              value={contactRole}
              onChange={(e) => setContactRole(e.target.value)}
              required
            />
            <select value={contactChannel} onChange={(e) => setContactChannel(e.target.value)}>
              <option value="EMAIL">EMAIL</option>
              <option value="IN_APP">IN_APP</option>
              <option value="WEBHOOK">WEBHOOK</option>
            </select>
            <input
              placeholder="Contact value"
              value={contactValue}
              onChange={(e) => setContactValue(e.target.value)}
              required
            />
            <input
              type="number"
              placeholder="Ack timeout (min)"
              value={contactTimeout}
              onChange={(e) => setContactTimeout(Number(e.target.value))}
              required
            />
            <button type="submit" className="primary">Add contact</button>
          </form>
        </section>

        {error && (
          <div className="card alert">
            <strong>Error:</strong> {error}
          </div>
        )}
      </main>
    </>
  );
}
