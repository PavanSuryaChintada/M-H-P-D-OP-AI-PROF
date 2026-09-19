// Doc 15 R4 — idempotency store. A replayed write (same hospital + key)
// returns the original response body instead of re-executing the write.

import { and, eq } from "drizzle-orm";
import { withHospitalContext } from "../tenant";
import { ehrIdempotencyRecords } from "../schema";

export async function findIdempotentResponse(hospitalId: string, idempotencyKey: string) {
  return withHospitalContext(hospitalId, async (tx) => {
    const [row] = await tx
      .select()
      .from(ehrIdempotencyRecords)
      .where(and(eq(ehrIdempotencyRecords.hospitalId, hospitalId), eq(ehrIdempotencyRecords.idempotencyKey, idempotencyKey)));
    return row ?? null;
  });
}

export async function recordIdempotentResponse(
  hospitalId: string,
  idempotencyKey: string,
  operation: string,
  responseBody: unknown,
) {
  return withHospitalContext(hospitalId, async (tx) => {
    const [row] = await tx
      .insert(ehrIdempotencyRecords)
      .values({ hospitalId, idempotencyKey, operation, responseBody })
      .onConflictDoNothing({ target: [ehrIdempotencyRecords.hospitalId, ehrIdempotencyRecords.idempotencyKey] })
      .returning();
    return row ?? null;
  });
}
