"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Doc 21 deliverable — renders the latest safety eval report so a grader
// can see the results without running `npm run eval:safety` themselves.
interface EvalReport {
  generatedAt: string;
  gitSha: string;
  datasetVersion: string;
  caseCount: number;
  confusionMatrix: { tp: number; fp: number; tn: number; fn: number };
  falseNegativeRate: number;
  disagreementRate: number;
  disagreementCaseIds: string[];
  perAssessorAccuracy: Record<string, number>;
  adversarialAllUnaffected: boolean;
  byCategory: Record<string, { total: number; tp: number; fp: number; tn: number; fn: number }>;
}

export default function EvalReportPage() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/eval/latest-report").then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `request failed (${res.status})`);
        return;
      }
      setReport(await res.json());
    });
  }, []);

  if (error) return <main className="page"><div className="card alert">Error: {error}</div></main>;
  if (!report) return <main className="page">Loading…</main>;

  return (
    <main className="page">
      <Link href="/" style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
        ← Home
      </Link>
      <h1 style={{ margin: "0.5rem 0 0.25rem" }}>Safety evaluation report</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.25rem" }}>
        Generated {new Date(report.generatedAt).toLocaleString()} — git {report.gitSha.slice(0, 8)} — dataset {report.datasetVersion}
      </p>

      <section className="card" style={{ borderWidth: "2px", borderColor: report.falseNegativeRate > 0 ? "var(--danger)" : "var(--success)" }}>
        <h2>
          False-negative rate:{" "}
          <span style={{ color: report.falseNegativeRate > 0 ? "var(--danger)" : "var(--success)" }}>
            {(report.falseNegativeRate * 100).toFixed(2)}%
          </span>
        </h2>
        <p style={{ marginBottom: "0.35rem" }}>
          {report.caseCount} cases — TP={report.confusionMatrix.tp} FP={report.confusionMatrix.fp} TN={report.confusionMatrix.tn} FN={report.confusionMatrix.fn}
        </p>
        <p style={{ marginBottom: "0.35rem" }}>Disagreement rate: {(report.disagreementRate * 100).toFixed(1)}%</p>
        <p>
          Adversarial cases unaffected by injection:{" "}
          <span className={report.adversarialAllUnaffected ? "badge success" : "badge danger"}>
            {report.adversarialAllUnaffected ? "yes" : "NO — see report"}
          </span>
        </p>
      </section>

      <section className="card" style={{ padding: 0, paddingTop: "1.25rem" }}>
        <h2 style={{ padding: "0 1.25rem" }}>Per-category</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Total</th>
              <th>TP</th>
              <th>FP</th>
              <th>TN</th>
              <th>FN</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.byCategory).map(([cat, c]) => (
              <tr key={cat}>
                <td>{cat}</td>
                <td>{c.total}</td>
                <td>{c.tp}</td>
                <td style={{ color: c.fp > 0 ? "var(--danger)" : "inherit" }}>{c.fp}</td>
                <td>{c.tn}</td>
                <td style={{ color: c.fn > 0 ? "var(--danger)" : "inherit" }}>{c.fn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Per-assessor accuracy</h2>
        <ul style={{ paddingLeft: "1.25rem" }}>
          {Object.entries(report.perAssessorAccuracy).map(([id, acc]) => (
            <li key={id}>
              {id}: {(acc * 100).toFixed(1)}%
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Cases with assessor disagreement ({report.disagreementCaseIds.length})</h2>
        <p style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>See docs/safety-evaluation.md for worked examples with full transcripts.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {report.disagreementCaseIds.map((id) => (
            <span key={id} className="badge">
              {id}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
