import { NextResponse } from "next/server";
import { getSystemHealth } from "@/lib/obs/health";

// Doc 19 R6 — unauthenticated by design (standard practice for
// infrastructure health checks — a load balancer or uptime monitor has no
// user session), and safe to leave that way: everything returned is an
// aggregate count, never a patient-level or hospital-identifying row.
export async function GET() {
  const health = await getSystemHealth();
  const httpStatus = health.status === "UNAVAILABLE" ? 503 : 200;
  return NextResponse.json(health, { status: httpStatus });
}
