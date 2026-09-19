import { z } from "zod";
import { NextResponse } from "next/server";
import { handleIdempotentWrite } from "../../../../lib/ehr/route-helpers";
import { ehrSystemContext } from "../../../../lib/ehr/system-context";
import { createTask } from "../../../../lib/db/repositories/tasks";

const BodySchema = z.object({
  hospitalId: z.uuid(),
  idempotencyKey: z.string().min(1),
  patientId: z.uuid(),
  encounterId: z.uuid().optional(),
  description: z.string().min(1),
  status: z.string().optional(),
  dueAt: z.iso.datetime().optional(),
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { hospitalId, idempotencyKey, dueAt, ...rest } = parsed.data;

  return handleIdempotentWrite(hospitalId, idempotencyKey, "createTask", async () => {
    const row = await createTask(ehrSystemContext(hospitalId), {
      ...rest,
      dueAt: dueAt ? new Date(dueAt) : undefined,
    });
    return { resourceType: "Task", id: row.id, status: "success" };
  });
}
