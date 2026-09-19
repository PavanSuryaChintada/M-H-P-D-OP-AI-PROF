"use client";

import { useEffect, useState } from "react";

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

  if (error) return <main style={{ padding: "2rem" }}>Error: {error}</main>;
  if (!report) return <main style={{ padding: "2rem" }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Safety evaluation report</h1>
      <p style={{ color: "#666" }}>
        Generated {new Date(report.generatedAt).toLocaleString()} — git {report.gitSha.slice(0, 8)} — dataset {report.datasetVersion}
      </p>

      <section style={{ border: "2px solid #333", padding: "1rem", marginBottom: "1rem" }}>
        <h2>
          False-negative rate: <span style={{ color: report.falseNegativeRate > 0 ? "red" : "green" }}>{(report.falseNegativeRate * 100).toFixed(2)}%</span>
        </h2>
        <p>
          {report.caseCount} cases — TP={report.confusionMatrix.tp} FP={report.confusionMatrix.fp} TN={report.confusionMatrix.tn} FN={report.confusionMatrix.fn}
        </p>
        <p>Disagreement rate: {(report.disagreementRate * 100).toFixed(1)}%</p>
        <p>Adversarial cases unaffected by injection: {report.adversarialAllUnaffected ? "yes" : "NO — see report"}</p>
      </section>

      <section style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
        <h2>Per-category</h2>
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Category</th>
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
                <td style={{ textAlign: "center" }}>{c.total}</td>
                <td style={{ textAlign: "center" }}>{c.tp}</td>
                <td style={{ textAlign: "center", color: c.fp > 0 ? "red" : "inherit" }}>{c.fp}</td>
                <td style={{ textAlign: "center" }}>{c.tn}</td>
                <td style={{ textAlign: "center", color: c.fn > 0 ? "red" : "inherit" }}>{c.fn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
        <h2>Per-assessor accuracy</h2>
        <ul>
          {Object.entries(report.perAssessorAccuracy).map(([id, acc]) => (
            <li key={id}>
              {id}: {(acc * 100).toFixed(1)}%
            </li>
          ))}
        </ul>
      </section>

      <section style={{ border: "1px solid #ccc", padding: "1rem" }}>
        <h2>Cases with assessor disagreement ({report.disagreementCaseIds.length})</h2>
        <p style={{ color: "#666" }}>See docs/safety-evaluation.md for worked examples with full transcripts.</p>
        <ul>
          {report.disagreementCaseIds.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
