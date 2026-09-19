import { z } from "zod";
import { NextResponse } from "next/server";
import { handleIdempotentWrite } from "../../../../lib/ehr/route-helpers";
import { ehrSystemContext } from "../../../../lib/ehr/system-context";
import { createCommunication } from "../../../../lib/db/repositories/communications";

const BodySchema = z.object({
  hospitalId: z.uuid(),
  idempotencyKey: z.string().min(1),
  patientId: z.uuid(),
  encounterId: z.uuid().optional(),
  channel: z.string().optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  content: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { hospitalId, idempotencyKey, ...payload } = parsed.data;

  return handleIdempotentWrite(hospitalId, idempotencyKey, "writeCommunication", async () => {
    const row = await createCommunication(ehrSystemContext(hospitalId), payload);
    return { resourceType: "Communication", id: row.id, status: "success" };
  });
}
