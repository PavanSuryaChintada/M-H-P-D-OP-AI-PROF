"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import HospitalNav from "../../HospitalNav";

// Doc 17 R3 acceptance criteria: "A reviewer can go from work queue to
// informed resolution without opening another page or asking a question
// the UI cannot answer." Every section below is one of R3's required
// sections; nothing here links out to a separate page for more detail.

interface Evidence {
  turn_index: number;
  excerpt: string;
}
interface Indicator {
  indicator_id: string;
  description: string;
  severity: string;
  evidence: Evidence;
  protocol_reference: { chunk_id: string; protocol_id: string; version: string };
}
interface Assessment {
  id: string;
  assessorId: string;
  status: string;
  classification: string | null;
  confidence: string | null;
  observedIndicators: Indicator[] | null;
  evidence: unknown;
  errorDetail: string | null;
}
interface TranscriptTurn {
  turnIndex: number;
  speaker: string;
  content: string;
}
interface ReviewData {
  escalation: {
    id: string;
    state: string;
    priority: number;
    triggerReason: string;
    patientId: string;
    consensusResult: { ruleFired?: number; reason?: string; disagreement?: boolean } | null;
    createdAt: string;
    assignedTo: string | null;
    resolution: string | null;
    resolutionOutcome: string | null;
  };
  patient: { id: string; firstName: string; lastName: string; mrn: string } | null;
  encounter: { id: string; dischargeAt: string | null; dischargeInstructions: string | null; riskLevel: string | null } | null;
  conditions: { id: string; codeText: string }[];
  medications: { id: string; name: string; dosage: string | null }[];
  call: { id: string; outcome: string | null } | null;
  transcript: TranscriptTurn[];
  assessments: Assessment[];
  consensusResult: unknown;
  previousOutreachHistory: { id: string; outcome: string | null; createdAt: string }[];
}

const RESOLUTION_OUTCOMES = [
  "contacted_patient",
  "advised_self_care",
  "booked_appointment",
  "referred_to_emergency",
  "no_action_needed_false_positive",
  "unable_to_contact",
  "other",
];

export default function EscalationReviewPage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const escalationId = params.escalationId as string;
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolveOutcome, setResolveOutcome] = useState(RESOLUTION_OUTCOMES[0]);
  const [resolveNotes, setResolveNotes] = useState("");
  const [infoReason, setInfoReason] = useState("");
  const [followUpDescription, setFollowUpDescription] = useState("");

  const load = useCallback(() => {
    fetch(`/api/hospitals/${hospitalId}/escalations/${escalationId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `request failed (${res.status})`);
          return;
        }
        setData(await res.json());
        setError(null);
      });
  }, [hospitalId, escalationId]);

  useEffect(() => load(), [load]);

  async function runAction(body: Record<string, unknown>) {
    setActionError(null);
    const res = await fetch(`/api/hospitals/${hospitalId}/escalations/${escalationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({}));
      setActionError(respBody.error ?? `action failed (${res.status})`);
      return;
    }
    load();
  }

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

  const { escalation, patient, encounter, conditions, medications, transcript, assessments, previousOutreachHistory } = data;
  const highlightedTurnIndexes = new Set(
    assessments.flatMap((a) => (a.observedIndicators ?? []).map((i) => i.evidence.turn_index)),
  );

  return (
    <>
      <HospitalNav hospitalId={hospitalId} />
      <main className="page">
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}>
          <h1>Escalation</h1>
          <span className={escalation.state === "OVERDUE" ? "badge danger" : "badge"}>{escalation.state}</span>
        </div>
        <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
          Priority {escalation.priority} · Trigger: {escalation.triggerReason}
        </p>
        {actionError && <div className="card alert">{actionError}</div>}

        {/* R3 — patient summary: conditions, medications, discharge date/instructions, risk indicators */}
        <section className="card">
          <h2>Patient summary</h2>
          {patient && (
            <p style={{ marginBottom: "0.5rem" }}>
              {patient.firstName} {patient.lastName} — MRN {patient.mrn}
            </p>
          )}
          {encounter && (
            <p style={{ marginBottom: "0.5rem" }}>
              Discharged {encounter.dischargeAt ? new Date(encounter.dischargeAt).toLocaleString() : "unknown"} — risk{" "}
              <strong>{encounter.riskLevel ?? "unset"}</strong>
              {encounter.dischargeInstructions && <div style={{ color: "var(--muted)" }}>{encounter.dischargeInstructions}</div>}
            </p>
          )}
          <p>
            <strong>Conditions:</strong> {conditions.map((c) => c.codeText).join(", ") || "none recorded"}
          </p>
          <p>
            <strong>Medications:</strong> {medications.map((m) => `${m.name}${m.dosage ? ` (${m.dosage})` : ""}`).join(", ") || "none recorded"}
          </p>
        </section>

        {/* R3 — full transcript with indicator-triggering turns highlighted */}
        <section className="card">
          <h2>Transcript</h2>
          {transcript.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No transcript (call did not connect).</p>
          ) : (
            <ol style={{ listStyle: "none" }}>
              {transcript.map((t) => (
                <li
                  key={t.turnIndex}
                  style={{
                    background: highlightedTurnIndexes.has(t.turnIndex) ? "var(--warning-bg)" : "transparent",
                    borderLeft: highlightedTurnIndexes.has(t.turnIndex) ? "3px solid var(--warning)" : "3px solid transparent",
                    padding: "0.4rem 0.6rem",
                    marginBottom: "0.15rem",
                    borderRadius: "4px",
                  }}
                >
                  <strong>{t.speaker}:</strong> {t.content}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* R3 — three assessments side by side, firing consensus rule labelled; protocol evidence expandable */}
        <section className="card">
          <h2>Assessments</h2>
          <p style={{ marginBottom: "0.75rem" }}>
            Consensus rule fired: <strong>{escalation.consensusResult?.ruleFired ?? "n/a"}</strong>
            {escalation.consensusResult?.reason ? ` — ${escalation.consensusResult.reason}` : ""}
            {escalation.consensusResult?.disagreement ? <span className="badge warn" style={{ marginLeft: "0.5rem" }}>disagreement</span> : ""}
          </p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {assessments.map((a) => (
              <div key={a.id} style={{ flex: "1 1 220px", border: "1px solid var(--border)", borderRadius: "8px", padding: "0.75rem" }}>
                <strong>{a.assessorId}</strong>
                <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                  {a.status} · {a.classification ?? "n/a"} · confidence {a.confidence ?? "n/a"}
                </div>
                {a.errorDetail && <div style={{ color: "var(--danger)", marginTop: "0.35rem" }}>{a.errorDetail}</div>}
                {(a.observedIndicators ?? []).map((ind) => (
                  <details key={ind.indicator_id} style={{ marginTop: "0.5rem" }}>
                    <summary style={{ cursor: "pointer" }}>
                      {ind.description} ({ind.severity})
                    </summary>
                    <div style={{ marginTop: "0.35rem", color: "var(--muted)" }}>Excerpt: &ldquo;{ind.evidence.excerpt}&rdquo;</div>
                    <div style={{ color: "var(--muted)" }}>
                      Protocol: {ind.protocol_reference.protocol_id} v{ind.protocol_reference.version} — chunk{" "}
                      {ind.protocol_reference.chunk_id}
                    </div>
                  </details>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* R3 — previous outreach history */}
        <section className="card">
          <h2>Previous outreach history</h2>
          {previousOutreachHistory.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No previous attempts for this patient.</p>
          ) : (
            <ul style={{ paddingLeft: "1.25rem" }}>
              {previousOutreachHistory.map((c) => (
                <li key={c.id}>
                  {new Date(c.createdAt).toLocaleString()} — {c.outcome ?? "in progress"}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* R3 — action bar: acknowledge, assign/reassign, request info, resolve, create follow-up task */}
        <section className="card">
          <h2>Actions</h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <button onClick={() => runAction({ action: "acknowledge" })}>Acknowledge</button>
            <button onClick={() => runAction({ action: "assign" })}>Assign to me</button>
            <button onClick={() => runAction({ action: "move_to_review" })}>Start review</button>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <input
              placeholder="Reason for requesting more information"
              value={infoReason}
              onChange={(e) => setInfoReason(e.target.value)}
              style={{ flex: "1 1 300px" }}
            />
            <button onClick={() => runAction({ action: "request_info", reason: infoReason })} disabled={!infoReason}>
              Request more info
            </button>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <select value={resolveOutcome} onChange={(e) => setResolveOutcome(e.target.value)}>
              {RESOLUTION_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <input
              placeholder="Resolution notes (required)"
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              style={{ flex: "1 1 260px" }}
            />
            <button
              className="primary"
              onClick={() => runAction({ action: "resolve", outcome: resolveOutcome, notes: resolveNotes })}
              disabled={!resolveNotes}
            >
              Resolve
            </button>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              placeholder="Follow-up task description"
              value={followUpDescription}
              onChange={(e) => setFollowUpDescription(e.target.value)}
              style={{ flex: "1 1 300px" }}
            />
            <button
              onClick={() => runAction({ action: "create_followup", description: followUpDescription })}
              disabled={!followUpDescription}
            >
              Create follow-up task
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
