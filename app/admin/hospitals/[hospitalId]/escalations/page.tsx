"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import HospitalNav from "../HospitalNav";

// Doc 17 R5 — reviewer work queue: OVERDUE pinned top, then priority desc,
// then age asc (the API already returns it in this order — this page just
// renders it and adds a status filter).
//
// UI-DESIGN-SPEC.md section 5.6: the previous version of this page could
// render an error panel and an empty-queue message at the same time,
// because it tracked loading/error/data as three independent booleans.
// Here there are exactly two pieces of state - `rows` (last good data, or
// null if we've never had any) and `errorMessage` (set only when the most
// recent poll failed) - and every one of the four visual states below maps
// to exactly one (rows, errorMessage) combination, so the contradictory
// case is structurally unreachable rather than merely avoided by care.
interface QueueEscalation {
  id: string;
  patientId: string;
  triggerReason: string;
  priority: number;
  state: string;
  createdAt: string;
}

const STATUS_FILTERS = ["ALL", "OPEN", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_INFORMATION", "OVERDUE"];

function ageLabel(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function filterLabel(s: string) {
  return s
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}

// Doc 13's consensus priority (HIGH/MEDIUM/LOW -> 3/2/1, see
// lib/ai/run-consensus.ts) mapped onto the design spec's clinical status
// vocabulary. OVERDUE is a workflow-state breach, not a priority level, so
// it overrides whatever the priority-derived status would otherwise be.
function statusFor(row: QueueEscalation): { cls: string; label: string } {
  if (row.state === "OVERDUE") return { cls: "overdue", label: "Overdue" };
  if (row.priority >= 3) return { cls: "urgent", label: "High" };
  if (row.priority === 2) return { cls: "concerning", label: "Medium" };
  if (row.priority === 1) return { cls: "routine", label: "Low" };
  return { cls: "uncertain", label: "Unset" };
}

export default function EscalationQueuePage() {
  const params = useParams();
  const hospitalId = params.hospitalId as string;
  const [rows, setRows] = useState<QueueEscalation[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [status, setStatus] = useState("ALL");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Fetches the full active-work superset (no status param) once per
        // poll and filters client-side below - the API already returns it
        // sorted OVERDUE-first/priority desc/age asc, and this avoids a
        // network round trip per segment click for a dataset this size.
        const res = await fetch(`/api/hospitals/${hospitalId}/escalations`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorMessage(body.error ?? `Request failed (${res.status})`);
          return;
        }
        const data: QueueEscalation[] = await res.json();
        if (cancelled) return;
        setRows(data);
        setErrorMessage(null);
        setLastUpdated(new Date());
      } catch {
        if (!cancelled) setErrorMessage("Couldn't reach the server.");
      }
    }

    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hospitalId]);

  const counts: Record<string, number> = { ALL: rows?.length ?? 0 };
  for (const f of STATUS_FILTERS.slice(1)) counts[f] = rows?.filter((r) => r.state === f).length ?? 0;
  const filteredRows = (rows ?? []).filter((r) => status === "ALL" || r.state === status);

  return (
    <>
      <HospitalNav hospitalId={hospitalId} />
      <main className="page wide">
        <h1 style={{ marginBottom: "1rem" }}>Escalation queue</h1>

        <div className="segmented">
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={status === s ? "active" : ""}>
              {filterLabel(s)}
              <span className="count">{rows ? counts[s] : "—"}</span>
            </button>
          ))}
        </div>

        {/* First load failed - we have nothing to show yet. */}
        {rows === null && errorMessage !== null && (
          <div className="error-state">
            <span className="icon">⚠</span>
            <div>
              <div className="title">Couldn&rsquo;t load escalations</div>
              <div className="detail">{errorMessage}. Retry, or check system health.</div>
              <div className="actions">
                <button onClick={() => window.location.reload()}>Retry</button>
                <Link href="/admin/health" className="btn">
                  System health
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* A later poll failed, but we already have rows - keep them on
            screen rather than blank a reviewer's queue over one bad poll. */}
        {rows !== null && errorMessage !== null && (
          <div className="stale-banner">
            Showing data from {lastUpdated ? ageLabel(lastUpdated.toISOString()) : "earlier"} &middot; reconnecting&hellip;
          </div>
        )}

        {rows === null && errorMessage === null && (
          <div className="card" style={{ padding: 0 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="skeleton-row" key={i}>
                <div className="skeleton-bar" />
              </div>
            ))}
          </div>
        )}

        {rows !== null && filteredRows.length === 0 && (
          <div className="empty-state">
            <div className="title">No escalations{status !== "ALL" ? ` in ${filterLabel(status).toLowerCase()}` : ""}.</div>
            <div>Escalations move here once a reviewer starts working on them.</div>
          </div>
        )}

        {rows !== null && filteredRows.length > 0 && (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Trigger</th>
                  <th>Age</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((e) => {
                  const s = statusFor(e);
                  return (
                    <tr key={e.id}>
                      <td>
                        <span className={`status ${s.cls}`}>{s.label}</span>
                      </td>
                      <td>{e.triggerReason}</td>
                      <td className="mono meta">{ageLabel(e.createdAt)}</td>
                      <td>
                        <Link href={`/admin/hospitals/${hospitalId}/escalations/${e.id}`} className="btn">
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
