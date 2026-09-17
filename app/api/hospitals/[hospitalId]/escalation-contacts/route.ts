import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformAdmin } from "@/lib/auth/guard";
import { getHospitalById } from "@/lib/db/repositories/hospitals";
import {
  addEscalationContact,
  listEscalationContacts,
} from "@/lib/db/repositories/escalation-contacts";
import { writeAuditLog } from "@/lib/db/repositories/audit";
import type { TenantContext } from "@/lib/db/tenant";

const AddContactSchema = z.object({
  orderIndex: z.number().int().min(0),
  role: z.string().min(1),
  channel: z.enum(["IN_APP", "EMAIL", "WEBHOOK"]),
  contactValue: z.string().min(1),
  ackTimeoutMinutes: z.number().int().positive(),
});

async function requireHospitalAndPa(request: NextRequest, hospitalId: string) {
  const gate = await guardPlatformAdmin("hospital:configure");
  if (gate instanceof Response) return gate;

  const hospital = await getHospitalById(hospitalId);
  if (!hospital) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ctx: TenantContext = { hospitalId, userId: gate.id, role: "PLATFORM_ADMIN" };
  return ctx;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const result = await requireHospitalAndPa(_request, hospitalId);
  if (result instanceof Response) return result;

  const contacts = await listEscalationContacts(result);
  return NextResponse.json(contacts);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ hospitalId: string }> }) {
  const { hospitalId } = await params;
  const result = await requireHospitalAndPa(request, hospitalId);
  if (result instanceof Response) return result;
  const ctx = result;

  const body = await request.json().catch(() => null);
  const parsed = AddContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const contact = await addEscalationContact(ctx, parsed.data);
  await writeAuditLog(ctx, {
    action: "hospital.escalation_contact_added",
    resourceType: "escalation_contact",
    resourceId: contact.id,
  });

  return NextResponse.json(contact, { status: 201 });
}
