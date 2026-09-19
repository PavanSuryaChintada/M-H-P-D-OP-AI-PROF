import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { guardPlatformAdmin } from "@/lib/auth/guard";

// Doc 21 deliverable — "an in-app page rendering the latest report, the
// grader sees it without running anything." Gated by guardPlatformAdmin
// (an eval report is an engineering/ops artifact, not hospital-scoped
// clinical data) rather than guard(), since there's no hospitalId here.
export async function GET() {
  const gate = await guardPlatformAdmin("analytics:platform_aggregate");
  if (gate instanceof Response) return gate;

  const reportsDir = path.join(process.cwd(), "eval", "reports");
  if (!fs.existsSync(reportsDir)) return NextResponse.json({ error: "no reports yet" }, { status: 404 });

  const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) return NextResponse.json({ error: "no reports yet" }, { status: 404 });

  const latest = files[files.length - 1];
  const report = JSON.parse(fs.readFileSync(path.join(reportsDir, latest), "utf-8"));
  return NextResponse.json(report);
}
