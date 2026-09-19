// Doc 16 required tests: a duplicate-delivered event is processed once (its
// side effect is not repeated); an out-of-order acknowledgment (happening
// before a scheduled timeout-check fires) converges correctly instead of
// over-notifying; an unacknowledged escalation reaches the backup reviewer
// and then OVERDUE, exactly per PRD §20's chain.

import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital, updateHospitalConfig } from "../lib/db/repositories/hospitals";
import { HospitalConfigSchema } from "../lib/hospitals/config-schema";
import { createEscalation, getEscalationById, acknowledgeEscalation } from "../lib/db/repositories/escalations";
import { listNotificationsForEscalation } from "../lib/db/repositories/notifications";
import { startEscalationNotificationChain, handleEscalationTimeoutCheck } from "../lib/events/handlers/escalation-notifications";
import { processNextEvent } from "../lib/events/dispatcher";
import type { TenantContext } from "../lib/db/tenant";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false, ssl: "require" });

let hospital: { id: string };
let primaryReviewerId: string;
let backupReviewerId: string;
const ctx = (): TenantContext => ({ hospitalId: hospital.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" });

async function seedEscalation(patientMrn: string) {
  const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospital.id}, ${patientMrn}, 'Esc', 'Test') returning id`;
  return createEscalation(ctx(), { patientId: patient.id, triggerReason: "test", priority: 2 });
}

beforeAll(async () => {
  hospital = await createHospital({ name: "Events/Notifications Test Hospital", shortCode: `EVT-${Date.now()}`, timezone: "UTC" });
  const [primary] = await admin`insert into users (email, display_name) values (${"primary-" + Date.now() + "@test.local"}, 'Primary Reviewer') returning id`;
  const [backup] = await admin`insert into users (email, display_name) values (${"backup-" + Date.now() + "@test.local"}, 'Backup Reviewer') returning id`;
  primaryReviewerId = primary.id;
  backupReviewerId = backup.id;
  await updateHospitalConfig(
    hospital.id,
    HospitalConfigSchema.parse({
      callingHours: { MON: { start: "00:00", end: "23:59" } },
      maxConcurrentCalls: 10,
      defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60], jitterPct: 10 },
      defaultFollowUpWindowHours: 168,
      notificationPreferences: { channels: ["IN_APP"], reviewerTimeoutMinutes: 30, backupReviewerUserId: backupReviewerId },
      ehrSettings: { mode: "mock", failureRate: 0 },
    }),
  );
});

describe("event dispatcher (doc 16 R1/R3)", () => {
  it("a duplicate-delivered event is processed once — the handler's side effect is not repeated", async () => {
    const { row: escalation } = await seedEscalation("EVT-P1");
    await startEscalationNotificationChain(ctx(), escalation.id, primaryReviewerId);

    const first = await processNextEvent(hospital.id);
    expect(first.processed).toBe(true);
    expect(first.error).toBeUndefined();

    const afterFirst = await listNotificationsForEscalation(ctx(), escalation.id);
    expect(afterFirst).toHaveLength(1);

    // Simulate duplicate delivery: the same event row is redelivered (e.g.
    // a crash after the handler ran but before markEventDone committed).
    const eventId = first.eventId!;
    await admin`update events set status = 'PENDING' where id = ${eventId}`;
    const second = await processNextEvent(hospital.id);
    expect(second.processed).toBe(true);
    expect(second.eventId).toBe(first.eventId);

    const afterSecond = await listNotificationsForEscalation(ctx(), escalation.id);
    expect(afterSecond).toHaveLength(1); // still one — the handler's own idempotency guard, not just the event layer's
  }, 30000);
});

describe("escalation notification chain (doc 16 R5)", () => {
  it("out-of-order: an acknowledgment that happens before the scheduled timeout-check fires converges without notifying the backup reviewer", async () => {
    const { row: escalation } = await seedEscalation("EVT-P2");
    await acknowledgeEscalation(ctx(), escalation.id);

    // The primary timeout-check would normally have been scheduled by
    // handleEscalationCreated; here it "fires" (is invoked directly,
    // simulating its scheduled_for having arrived) after the acknowledgment
    // already happened — exactly the out-of-order case R3 requires to
    // converge correctly rather than corrupt state.
    await handleEscalationTimeoutCheck(hospital.id, { escalationId: escalation.id, stage: "primary", backupReviewerUserId: backupReviewerId });

    const notifications = await listNotificationsForEscalation(ctx(), escalation.id);
    expect(notifications.filter((n) => n.subject?.includes(":backup"))).toHaveLength(0);

    const refetched = await getEscalationById(ctx(), escalation.id);
    expect(refetched?.state).toBe("ACKNOWLEDGED"); // not overwritten back to anything else
  }, 30000);

  it("an unacknowledged escalation reaches the backup reviewer, then OVERDUE", async () => {
    const { row: escalation } = await seedEscalation("EVT-P3");

    await handleEscalationTimeoutCheck(hospital.id, { escalationId: escalation.id, stage: "primary", backupReviewerUserId: backupReviewerId });
    const afterPrimaryTimeout = await listNotificationsForEscalation(ctx(), escalation.id);
    expect(afterPrimaryTimeout.some((n) => n.subject?.includes(":backup"))).toBe(true);
    expect((await getEscalationById(ctx(), escalation.id))?.state).not.toBe("OVERDUE");

    await handleEscalationTimeoutCheck(hospital.id, { escalationId: escalation.id, stage: "backup" });
    const final = await getEscalationById(ctx(), escalation.id);
    expect(final?.state).toBe("OVERDUE");
  }, 30000);
});
