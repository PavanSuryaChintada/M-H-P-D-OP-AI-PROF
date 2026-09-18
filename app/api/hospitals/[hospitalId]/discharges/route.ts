import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { DischargeRecordSchema, type DischargeRecord } from "@/lib/discharge/schema";
import { ingestDischargeRecord } from "@/lib/discharge/ingest";

interface RejectedRecord {
  index: number;
  field: string;
  reason: string;
}

/** Accepts either a JSON array or NDJSON (one record per line) body. */
function parseBody(raw: string): { records: unknown[] } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { records: [] };

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return { error: "body must be a JSON array or NDJSON" };
      return { records: parsed };
    } catch {
      return { error: "invalid JSON array" };
    }
  }

  // NDJSON — parse errors here become per-line rejections below, not a
  // whole-request failure, so one bad line can't take down the batch.
  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
  const records = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { __parseError: true };
    }
  });
  return { records };
}

// Doc 04 R4 — partial success is allowed, silent drops are not: every
// record ends up in exactly one of accepted/rejected.
export async function POST(request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const gate = await guard(hospitalId, "discharge:upload");
  if (gate instanceof Response) return gate;
  const ctx = gate;

  const raw = await request.text();
  const parsedBody = parseBody(raw);
  if ("error" in parsedBody) {
    return NextResponse.json({ error: parsedBody.error }, { status: 400 });
  }

  const accepted: { index: number; patientId: string; encounterId: string; status: string }[] = [];
  const rejected: RejectedRecord[] = [];

  // Validation is cheap and synchronous — do it all up front, grouping
  // valid records by MRN. Records for different patients are independent
  // and safe to ingest concurrently; two records for the *same* MRN in one
  // batch (a re-admission) are not — concurrent find-or-create-patient
  // calls for the same MRN would race the unique constraint — so each
  // MRN's records are processed in order within their own group.
  const groups = new Map<string, { index: number; record: DischargeRecord }[]>();
  for (let index = 0; index < parsedBody.records.length; index++) {
    const item = parsedBody.records[index];
    if (item && typeof item === "object" && "__parseError" in item) {
      rejected.push({ index, field: "(line)", reason: "invalid JSON" });
      continue;
    }

    const parsed = DischargeRecordSchema.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      rejected.push({
        index,
        field: issue?.path.join(".") || "(root)",
        reason: issue?.message ?? "validation failed",
      });
      continue;
    }

    const key = parsed.data.patient.mrn;
    const group = groups.get(key) ?? [];
    group.push({ index, record: parsed.data });
    groups.set(key, group);
  }

  async function processGroup(group: { index: number; record: DischargeRecord }[]) {
    for (const { index, record } of group) {
      try {
        const result = await ingestDischargeRecord(ctx, record);
        accepted.push({ index, ...result });
      } catch (err) {
        rejected.push({
          index,
          field: "(record)",
          reason: err instanceof Error ? err.message : "ingestion failed",
        });
      }
    }
  }

  const groupList = [...groups.values()];
  let nextGroup = 0;
  async function lane() {
    while (nextGroup < groupList.length) {
      await processGroup(groupList[nextGroup++]);
    }
  }
  // Bounded by the same connection-pool ceiling as lib/db/client.ts (max: 10).
  await Promise.all(Array.from({ length: Math.min(10, groupList.length) }, lane));

  return NextResponse.json({ accepted, rejected });
}
