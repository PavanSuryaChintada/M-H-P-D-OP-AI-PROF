import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { listAuditLog } from "@/lib/db/repositories/audit";

// Doc 19 R5 — audit viewer, filterable by actor/action/date range.
export async function GET(request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "hospital:view_dashboard");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const actorUserId = url.searchParams.get("actor") ?? undefined;
  const action = url.searchParams.get("action") ?? undefined;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const rows = await listAuditLog(gate, {
    actorUserId,
    action,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  });
  return NextResponse.json(rows);
}
