"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import HospitalNav from "./HospitalNav";
import type { HospitalConfig } from "@/lib/hospitals/config-schema";

interface Hospital {
  id: string;
  name: string;
  shortCode: string;
  timezone: string;
  status: string;
  config: HospitalConfig | null;
}

const DAY_LABELS: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };
const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function summarizeCallingHours(hours: HospitalConfig["callingHours"] | undefined): string {
  if (!hours) return "Not set";
  const entries = DAY_ORDER.filter((d) => hours[d as keyof typeof hours]);
  if (entries.length === 0) return "No days configured";
  const windows = entries.map((d) => `${hours[d as keyof typeof hours]!.start}–${hours[d as keyof typeof hours]!.end}`);
  const allSame = windows.every((w) => w === windows[0]);
  if (allSame && entries.length === 7) return `Every day, ${windows[0]}`;
  if (allSame) return `${entries.map((d) => DAY_LABELS[d]).join("/")}, ${windows[0]}`;
  return entries.map((d, i) => `${DAY_LABELS[d]} ${windows[i]}`).join(" · ");
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
      const h: Hospital = await hRes.json();
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
          {hospital.config ? (
            <div className="stat-row">
              <div className="stat">
                <div className="label">Calling hours</div>
                <div className="value" style={{ fontSize: "1rem" }}>{summarizeCallingHours(hospital.config.callingHours)}</div>
              </div>
              <div className="stat">
                <div className="label">Max concurrent calls</div>
                <div className="value mono">{hospital.config.maxConcurrentCalls}</div>
              </div>
              <div className="stat">
                <div className="label">Retry policy</div>
                <div className="value" style={{ fontSize: "1rem" }}>
                  {hospital.config.defaultRetryPolicy.maxAttempts} attempts &middot; backoff {hospital.config.defaultRetryPolicy.backoffMinutes.join("/")}m &middot; &plusmn;{hospital.config.defaultRetryPolicy.jitterPct}% jitter
                </div>
              </div>
              <div className="stat">
                <div className="label">Follow-up window</div>
                <div className="value mono">{hospital.config.defaultFollowUpWindowHours}h</div>
              </div>
              <div className="stat">
                <div className="label">Notifications</div>
                <div className="value" style={{ fontSize: "1rem" }}>{hospital.config.notificationPreferences.channels.join(" + ")}, {hospital.config.notificationPreferences.reviewerTimeoutMinutes}m timeout</div>
              </div>
              <div className="stat">
                <div className="label">EHR</div>
                <div className="value" style={{ fontSize: "1rem" }}>{hospital.config.ehrSettings.mode} &middot; {Math.round(hospital.config.ehrSettings.failureRate * 100)}% failure rate</div>
              </div>
            </div>
          ) : (
            <p className="meta">No configuration set yet &mdash; use the editor below.</p>
          )}

          <details>
            <summary style={{ cursor: "pointer", color: "var(--action)", fontSize: "13px" }}>Edit as JSON (advanced)</summary>
            <form onSubmit={handleSaveConfig} style={{ marginTop: "0.75rem" }}>
              <textarea
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                rows={16}
                className="mono"
                style={{ width: "100%", fontSize: "0.85rem", marginBottom: "0.75rem" }}
              />
              <button type="submit" className="primary">Save config</button>
            </form>
          </details>
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
