import { NextRequest, NextResponse } from "next/server";
import { guardPlatformAdmin } from "@/lib/auth/guard";
import { createHospital } from "@/lib/db/repositories/hospitals";
import { z } from "zod";

const CreateHospitalSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
});

// PLATFORM_ADMIN only — not scoped to any hospital (there isn't one yet).
export async function POST(request: NextRequest) {
  const gate = await guardPlatformAdmin("hospital:create");
  if (gate instanceof Response) return gate;

  const body = await request.json().catch(() => null);
  const parsed = CreateHospitalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const hospital = await createHospital(parsed.data);
  return NextResponse.json(hospital, { status: 201 });
}
