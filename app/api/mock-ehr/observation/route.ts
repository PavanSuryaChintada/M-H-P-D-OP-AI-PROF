import { z } from "zod";
import { NextResponse } from "next/server";
import { handleIdempotentWrite } from "../../../../lib/ehr/route-helpers";
import { ehrSystemContext } from "../../../../lib/ehr/system-context";
import { createObservation } from "../../../../lib/db/repositories/clinical";

const BodySchema = z.object({
  hospitalId: z.uuid(),
  idempotencyKey: z.string().min(1),
  patientId: z.uuid(),
  encounterId: z.uuid().optional(),
  code: z.string().min(1),
  value: z.unknown().optional(),
  effectiveAt: z.iso.datetime().optional(),
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { hospitalId, idempotencyKey, effectiveAt, ...rest } = parsed.data;

  return handleIdempotentWrite(hospitalId, idempotencyKey, "writeObservation", async () => {
    const row = await createObservation(ehrSystemContext(hospitalId), {
      ...rest,
      effectiveAt: effectiveAt ? new Date(effectiveAt) : undefined,
    });
    return { resourceType: "Observation", id: row.id, status: "success" };
  });
}
