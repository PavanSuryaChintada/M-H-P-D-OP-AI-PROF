import { z } from "zod";
import { NextResponse } from "next/server";
import { handleIdempotentWrite } from "../../../../lib/ehr/route-helpers";
import { ehrSystemContext } from "../../../../lib/ehr/system-context";
import { createCommunication } from "../../../../lib/db/repositories/communications";

// Doc 15 R1's writeEncounterNote has no dedicated FHIR table in this schema
// (doc 01/04 didn't anticipate a distinct "note" resource). Reusing
// communications — which already carries encounterId and free-text content
// — avoids a fourth schema migration for something that is, structurally,
// exactly a recorded communication against the encounter.
const BodySchema = z.object({
  hospitalId: z.uuid(),
  idempotencyKey: z.string().min(1),
  patientId: z.uuid(),
  encounterId: z.uuid().optional(),
  note: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { hospitalId, idempotencyKey, patientId, encounterId, note } = parsed.data;

  return handleIdempotentWrite(hospitalId, idempotencyKey, "writeEncounterNote", async () => {
    const row = await createCommunication(ehrSystemContext(hospitalId), {
      patientId,
      encounterId,
      channel: "EHR_NOTE",
      direction: "OUTBOUND",
      content: note,
    });
    return { resourceType: "EncounterNote", id: row.id, status: "success" };
  });
}
