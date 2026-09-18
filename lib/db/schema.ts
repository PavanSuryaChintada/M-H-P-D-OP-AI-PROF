// Drizzle schema — doc 01 (Data Model & Multi-Tenancy).
//
// R1: every patient-related table carries hospital_id uuid NOT NULL, no exceptions.
// R3: FHIR-shaped clinical tables keep fhir_resource_type + source_payload jsonb.
// R5: audit_log is append-only — UPDATE/DELETE revoked at the DB level (see rls.sql).
// R6: outreach_tasks carries the composite/partial indexes the scheduler depends on.
// R7: task and escalation state changes are mirrored into *_state_transitions tables.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  date,
  index,
  uniqueIndex,
  customType,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// pgvector column type — Drizzle has no first-party vector type, so this is
// the standard customType wrapper (see Drizzle docs "pgvector").
// ---------------------------------------------------------------------------
const vector = (dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(",")
        .filter(Boolean)
        .map(Number);
    },
  });

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const roleEnum = pgEnum("role", [
  "PLATFORM_ADMIN",
  "HOSPITAL_ADMIN",
  "CAMPAIGN_MANAGER",
  "CLINICAL_REVIEWER",
]);

export const campaignStateEnum = pgEnum("campaign_state", [
  "DRAFT",
  "READY",
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
]);

// PRD §11
export const outreachTaskStateEnum = pgEnum("outreach_task_state", [
  "PENDING",
  "SCHEDULED",
  "CALLING",
  "CONNECTED",
  "COMPLETED",
  "NO_ANSWER",
  "BUSY",
  "VOICEMAIL",
  "DROPPED",
  "INVALID_NUMBER", // doc 07 §1
  "DECLINED", // doc 07 §1
  "RETRY_SCHEDULED",
  "CALLBACK_SCHEDULED",
  "ESCALATED",
  "MANUAL_FOLLOW_UP",
  "FAILED",
  "ELIGIBILITY_ERROR", // doc 07 §1 — a task-level re-evaluation failing; distinct from doc 05's eligibility_evaluations.status=ERROR, which happens before a task ever exists
]);

// Active states used by the partial index below (doc 01 R6) and by the
// scheduler's claim query (doc 06/07). Kept next to the enum so the two
// never drift apart.
export const OUTREACH_TASK_ACTIVE_STATES = [
  "PENDING",
  "SCHEDULED",
  "CALLING",
  "RETRY_SCHEDULED",
  "CALLBACK_SCHEDULED",
] as const;

// PRD §21
export const escalationStateEnum = pgEnum("escalation_state", [
  "OPEN",
  "ASSIGNED",
  "IN_REVIEW",
  "WAITING_FOR_INFORMATION",
  "RESOLVED",
  "CLOSED",
]);

// PRD §15
export const triageClassificationEnum = pgEnum("triage_classification", [
  "ROUTINE",
  "CONCERNING",
  "URGENT",
  "UNCERTAIN",
]);

// PRD §19
export const callOutcomeEnum = pgEnum("call_outcome", [
  "COMPLETED",
  "NO_ANSWER",
  "BUSY",
  "VOICEMAIL",
  "DROPPED",
  "INVALID_NUMBER",
  "DECLINED",
  "CALLBACK_REQUESTED",
  "ESCALATED",
  // Doc 07 §2 splits "technical failure" into these two on purpose: a
  // provider error must not consume the patient's retry budget, a network
  // failure (still not the patient's fault, but not "ours" either in the
  // same sense) does.
  "NETWORK_FAILURE",
  "PROVIDER_ERROR",
  "MANUAL_FOLLOW_UP",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "IN_APP",
  "EMAIL",
  "WEBHOOK",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "PENDING",
  "SENT",
  "FAILED",
]);

export const eventStatusEnum = pgEnum("event_status", [
  "PENDING",
  "PROCESSED",
  "FAILED",
]);

// Doc 14 R2/R6 — a failed EHR sync must be visible and retryable, never
// silently swallowed; this is the field doc 20's retry worker reads.
export const ehrSyncStatusEnum = pgEnum("ehr_sync_status", [
  "PENDING",
  "SYNCED",
  "FAILED",
]);

// PRD §4 / doc 03 R1 — CREATED: just created, no config yet. CONFIGURED: has
// operating config but hasn't cleared the readiness checklist. READY: passed
// the checklist (see lib/hospitals/readiness.ts) and can run campaigns.
export const hospitalStatusEnum = pgEnum("hospital_status", ["CREATED", "CONFIGURED", "READY"]);

// ---------------------------------------------------------------------------
// Core tenancy
// ---------------------------------------------------------------------------
export const hospitals = pgTable("hospitals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: text("address"),
  timezone: text("timezone").notNull(), // IANA, e.g. "America/New_York"
  status: hospitalStatusEnum("status").notNull().default("CREATED"),
  // Doc 03 R2 — operating config the scheduler and AI later read. Shape is
  // validated by lib/hospitals/config-schema.ts (zod) on every write, not
  // by a Postgres constraint — kept here as jsonb because doc 00's own
  // Claude Code prompt asks for "hospital_config jsonb validated by zod",
  // and because its shape (retry backoff arrays, per-weekday hours) doesn't
  // map cleanly onto flat columns.
  config: jsonb("config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("hospitals_short_code_idx").on(t.shortCode)]);

// Doc 03 R3 — ordered per-hospital escalation chain. `role` here is a
// free-text title ("Charge Nurse", "On-call Physician"), distinct from the
// 4-value RBAC role enum in user_hospital_roles.
export const escalationContacts = pgTable("escalation_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  orderIndex: integer("order_index").notNull(),
  role: text("role").notNull(),
  channel: notificationChannelEnum("channel").notNull(),
  contactValue: text("contact_value").notNull(), // email address, phone number, etc.
  ackTimeoutMinutes: integer("ack_timeout_minutes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("escalation_contacts_hospital_idx").on(t.hospitalId),
  uniqueIndex("escalation_contacts_hospital_order_idx").on(t.hospitalId, t.orderIndex),
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  authProviderId: text("auth_provider_id"), // Supabase Auth user id
  // PLATFORM_ADMIN is hospital-independent by definition (PRD §3 — manages
  // hospital tenants, sees aggregates across all of them), so it can't live
  // in user_hospital_roles the way the other three roles do. A user can
  // hold this flag AND separately hold a normal per-hospital role.
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
]);

export const userHospitalRoles = pgTable("user_hospital_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  role: roleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_hospital_roles_user_hospital_idx").on(t.userId, t.hospitalId),
  index("user_hospital_roles_hospital_idx").on(t.hospitalId),
]);

// ---------------------------------------------------------------------------
// FHIR-shaped clinical resources (doc 01 R3) — each keeps fhir_resource_type
// and source_payload jsonb rather than aiming for full FHIR compliance.
// ---------------------------------------------------------------------------
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  name: text("name").notNull(),
  type: text("type"),
  fhirResourceType: text("fhir_resource_type").notNull().default("Organization"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("organizations_hospital_idx").on(t.hospitalId)]);

export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  mrn: text("mrn").notNull(), // medical record number, unique per hospital
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dob: date("dob"),
  phone: text("phone"),
  email: text("email"),
  preferredLanguage: text("preferred_language"),
  communicationPreferences: jsonb("communication_preferences"),
  fhirResourceType: text("fhir_resource_type").notNull().default("Patient"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("patients_hospital_idx").on(t.hospitalId),
  uniqueIndex("patients_hospital_mrn_idx").on(t.hospitalId, t.mrn),
]);

// Doc 04 R2 — risk mix the queue's priority scoring (doc 06) reads.
export const riskLevelEnum = pgEnum("risk_level", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const encounters = pgTable("encounters", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  careSetting: text("care_setting"),
  admissionAt: timestamp("admission_at", { withTimezone: true }),
  dischargeAt: timestamp("discharge_at", { withTimezone: true }),
  dischargeInstructions: text("discharge_instructions"),
  // Doc 04 R2/R4/R5 — properties of the discharge itself, not a clinical
  // observation, so they live here rather than in a jsonb Observation value
  // where doc 05/06's eligibility and priority queries couldn't index them.
  riskLevel: riskLevelEnum("risk_level"),
  followUpWindowHours: integer("follow_up_window_hours"),
  // Doc 04 R5 idempotency key — the hospital feed's own message id for this
  // discharge. Unique per hospital when present; NULL for encounters not
  // created through the ingestion pipeline (Postgres treats multiple NULLs
  // in a unique index as distinct, so that's not a conflict).
  sourceMessageId: text("source_message_id"),
  fhirResourceType: text("fhir_resource_type").notNull().default("Encounter"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("encounters_hospital_idx").on(t.hospitalId),
  index("encounters_patient_idx").on(t.patientId),
  uniqueIndex("encounters_hospital_source_message_idx").on(t.hospitalId, t.sourceMessageId),
]);

export const conditions = pgTable("conditions", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  codeText: text("code_text").notNull(),
  clinicalStatus: text("clinical_status"),
  fhirResourceType: text("fhir_resource_type").notNull().default("Condition"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("conditions_hospital_idx").on(t.hospitalId)]);

export const observations = pgTable("observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  code: text("code").notNull(),
  value: jsonb("value"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  fhirResourceType: text("fhir_resource_type").notNull().default("Observation"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("observations_hospital_idx").on(t.hospitalId)]);

export const medications = pgTable("medications", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  name: text("name").notNull(),
  dosage: text("dosage"),
  status: text("status"),
  fhirResourceType: text("fhir_resource_type").notNull().default("Medication"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("medications_hospital_idx").on(t.hospitalId)]);

export const carePlans = pgTable("care_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status"),
  fhirResourceType: text("fhir_resource_type").notNull().default("CarePlan"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("care_plans_hospital_idx").on(t.hospitalId)]);

export const procedures = pgTable("procedures", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  name: text("name").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }),
  fhirResourceType: text("fhir_resource_type").notNull().default("Procedure"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("procedures_hospital_idx").on(t.hospitalId)]);

export const communications = pgTable("communications", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  channel: text("channel"),
  direction: text("direction"), // INBOUND | OUTBOUND
  content: text("content"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  fhirResourceType: text("fhir_resource_type").notNull().default("Communication"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("communications_hospital_idx").on(t.hospitalId)]);

// FHIR "Task" — a clinical follow-up task, distinct from outreach_tasks (the
// queue table below). Kept as its own table per doc 01 R3/R4.
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  description: text("description").notNull(),
  status: text("status").notNull().default("PENDING"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  fhirResourceType: text("fhir_resource_type").notNull().default("Task"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("tasks_hospital_idx").on(t.hospitalId)]);

// ---------------------------------------------------------------------------
// Protocols & retrieval (doc 11)
// ---------------------------------------------------------------------------
export const protocols = pgTable("protocols", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  title: text("title").notNull(),
  category: text("category"),
  content: text("content").notNull(), // the source document — chunking/retrieval reads this
  version: integer("version").notNull().default(1),
  // Doc 11 R1 — the structured form (follow_up_questions[], red_flags[],
  // approved_guidance[], escalation_rules[]), zod-validated on write
  // (lib/protocols/schema.ts). Added after doc 01's original schema, which
  // only stored the source text — the rule engine (doc 13) reads this,
  // never re-parses the free text.
  structuredContent: jsonb("structured_content"),
  specialty: text("specialty"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("protocols_hospital_idx").on(t.hospitalId)]);

export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  protocolId: uuid("protocol_id").references(() => protocols.id),
  sourceLabel: text("source_label").notNull(),
  content: text("content").notNull(),
  embedding: vector(1536)("embedding"),
  // Doc 11 R3/R6 — chunk metadata + the citation shape
  // {chunk_id, protocol_id, protocol_version, section, text} needs to
  // resolve without a second query. protocolVersion is snapshotted at
  // chunk-creation time (not re-joined from protocols.version, which can
  // change) so a citation always points at the exact text version it was
  // generated from.
  section: text("section"),
  heading: text("heading"),
  protocolVersion: integer("protocol_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("knowledge_chunks_hospital_idx").on(t.hospitalId)]);

// ---------------------------------------------------------------------------
// Campaigns & the outbound queue (docs 05, 06, 07)
// ---------------------------------------------------------------------------
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  name: text("name").notNull(),
  description: text("description"),
  state: campaignStateEnum("state").notNull().default("DRAFT"),
  eligibilityCriteria: jsonb("eligibility_criteria"),
  followUpWindowHours: integer("follow_up_window_hours"),
  callingHoursStart: text("calling_hours_start"), // "HH:MM" in hospital timezone
  callingHoursEnd: text("calling_hours_end"),
  priority: integer("priority").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  capacityShare: integer("capacity_share"), // optional per-campaign cap within hospital capacity
  protocolId: uuid("protocol_id").references(() => protocols.id), // doc 05 R2 — protocol binding
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("campaigns_hospital_idx").on(t.hospitalId)]);

// Doc 05 R1 — every campaign lifecycle move is guarded and logged here,
// same pattern as outreach_task_state_transitions.
export const campaignStateTransitions = pgTable("campaign_state_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  fromState: campaignStateEnum("from_state"),
  toState: campaignStateEnum("to_state").notNull(),
  reason: text("reason"),
  actor: text("actor").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("campaign_state_transitions_campaign_idx").on(t.campaignId)]);

// Doc 05 R5/R6 — one row per (campaign, patient), overwritten on
// re-evaluation (R4 resume recomputes rather than replaying). ERROR means
// the rule engine itself threw for this patient — R6 requires this be
// visible and recoverable, never a silent drop.
export const eligibilityStatusEnum = pgEnum("eligibility_status", ["ELIGIBLE", "INELIGIBLE", "ERROR"]);

export const eligibilityEvaluations = pgTable("eligibility_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  status: eligibilityStatusEnum("status").notNull(),
  ruleResults: jsonb("rule_results"), // RuleResult[] — {ruleId, passed, reason, evidence}
  errorMessage: text("error_message"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("eligibility_evaluations_campaign_idx").on(t.campaignId),
  uniqueIndex("eligibility_evaluations_campaign_patient_idx").on(t.campaignId, t.patientId),
]);

export const outreachTasks = pgTable("outreach_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  encounterId: uuid("encounter_id").references(() => encounters.id),
  state: outreachTaskStateEnum("state").notNull().default("PENDING"),
  priorityScore: numeric("priority_score", { precision: 12, scale: 4 }).notNull().default("0"),
  clinicalDeadlineAt: timestamp("clinical_deadline_at", { withTimezone: true }).notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  callbackRequestedAt: timestamp("callback_requested_at", { withTimezone: true }),
  claimedBy: text("claimed_by"), // worker instance id, set atomically on claim
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }), // reaper uses this to detect stale claims
  lastError: text("last_error"), // doc 07 §6/§2 — e.g. "lease_expired", or a technical-failure message
  // Doc 06 — snapshotted from the encounter at task-creation time rather
  // than joined live on every claim/recompute: the queue's hot path scores
  // hundreds of rows every 15s and shouldn't pay a join for data that's
  // fixed for the task's lifetime.
  riskLevel: riskLevelEnum("risk_level"),
  totalWindowHours: integer("total_window_hours"),
  // 0 = time-pinned callback, 1 = cutoff risk, 2 = scored pool. A stored
  // column (not computed in ORDER BY) so it's indexable — same reasoning
  // as priority_score.
  tier: integer("tier").notNull().default(2),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // R6: the scheduler's claim query filters on exactly these columns.
  index("outreach_tasks_hospital_state_scheduled_idx").on(t.hospitalId, t.state, t.scheduledFor),
  index("outreach_tasks_campaign_state_idx").on(t.campaignId, t.state),
  index("outreach_tasks_active_partial_idx")
    .on(t.hospitalId, t.state)
    .where(sql`${t.state} IN ('PENDING','SCHEDULED','CALLING','RETRY_SCHEDULED','CALLBACK_SCHEDULED')`),
  // Doc 06 claim query: ORDER BY tier ASC, priority_score DESC, created_at ASC.
  index("outreach_tasks_claim_order_idx").on(t.hospitalId, t.state, t.tier, t.priorityScore, t.createdAt),
]);

// R7: history of every outreach_task state change.
export const outreachTaskStateTransitions = pgTable("outreach_task_state_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  outreachTaskId: uuid("outreach_task_id").notNull().references(() => outreachTasks.id),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  fromState: outreachTaskStateEnum("from_state"),
  toState: outreachTaskStateEnum("to_state").notNull(),
  reason: text("reason"),
  actor: text("actor").notNull(), // "worker:<id>" | "user:<id>" | "system"
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("outreach_task_transitions_task_idx").on(t.outreachTaskId)]);

// ---------------------------------------------------------------------------
// Calls, triage, escalation (docs 10, 12, 13)
// ---------------------------------------------------------------------------
export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  outreachTaskId: uuid("outreach_task_id").notNull().references(() => outreachTasks.id),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  // Doc 07 §7 — UNIQUE (outreach_task_id, attempt_number) is what makes a
  // retried claim's call-record creation safe to retry itself.
  attemptNumber: integer("attempt_number").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  outcome: callOutcomeEnum("outcome"),
  // Doc 07 §5 — questions answered, symptoms reported, protocol step index,
  // last agent utterance. Read back on the next attempt after DROPPED so
  // the Voice Intake Agent (doc 10) resumes instead of restarting the
  // clinical questionnaire from zero.
  partialState: jsonb("partial_state"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("calls_hospital_idx").on(t.hospitalId),
  index("calls_outreach_task_idx").on(t.outreachTaskId),
  uniqueIndex("calls_task_attempt_idx").on(t.outreachTaskId, t.attemptNumber),
]);

export const callTurns = pgTable("call_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").notNull().references(() => calls.id),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  turnIndex: integer("turn_index").notNull(),
  speaker: text("speaker").notNull(), // AGENT | PATIENT
  content: text("content").notNull(),
  // Doc 10 R3 — "full call_turns (role, text, timestamp, latency)"; doc 01's
  // original table predates this and had no latency column.
  latencyMs: integer("latency_ms"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("call_turns_call_idx").on(t.callId)]);

export const triageResults = pgTable("triage_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  callId: uuid("call_id").notNull().references(() => calls.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  classification: triageClassificationEnum("classification").notNull(),
  observedIndicators: jsonb("observed_indicators"),
  evidence: jsonb("evidence"),
  protocolReferences: jsonb("protocol_references"),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  escalationRecommended: boolean("escalation_recommended").notNull(),
  modelProvider: text("model_provider").notNull(), // "anthropic" | "openai" | "rule-engine"
  // Doc 12 R7 — traceability columns, added after doc 01's original schema
  // (which predates doc 12's spec): raw model output, parsed result,
  // prompt version, model name (modelProvider above is the vendor id, not
  // this), retrieval chunk ids, validation attempt count, latency, cost.
  modelName: text("model_name"),
  promptVersion: text("prompt_version"),
  rawOutput: jsonb("raw_output"),
  parsedResult: jsonb("parsed_result"),
  retrievalChunkIds: jsonb("retrieval_chunk_ids"),
  validationAttempts: integer("validation_attempts").notNull().default(1),
  latencyMs: integer("latency_ms"),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("triage_results_hospital_idx").on(t.hospitalId)]);

export const escalations = pgTable("escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  callId: uuid("call_id").references(() => calls.id),
  // Doc 13 §4/deliverable 5 — "escalation creation is idempotent per
  // {task_id, attempt}", added after doc 01's original schema (which
  // predates doc 13). Nullable because not every future escalation source
  // need originate from an outreach task, but the consensus system's path
  // (the only writer per the hard rule below) always sets both, and the
  // unique index is what actually enforces the idempotency, not the
  // application remembering to check first.
  outreachTaskId: uuid("outreach_task_id").references(() => outreachTasks.id),
  attemptNumber: integer("attempt_number"),
  triggerReason: text("trigger_reason").notNull(),
  clinicalIndicators: jsonb("clinical_indicators"),
  consensusResult: jsonb("consensus_result"), // individual assessments + disagreement + final decision
  priority: integer("priority").notNull().default(0),
  state: escalationStateEnum("state").notNull().default("OPEN"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("escalations_hospital_idx").on(t.hospitalId),
  index("escalations_hospital_state_idx").on(t.hospitalId, t.state),
  uniqueIndex("escalations_task_attempt_idx").on(t.outreachTaskId, t.attemptNumber),
]);

// Doc 13 §3 — a snapshot of what each of the three assessors said AT THE
// MOMENT consensus ran, kept even if the underlying triage_results row is
// later changed. This is what makes "Claude said routine, GPT said
// concerning, the rule engine matched red flag HF-04 — escalated on rule 2"
// answerable from the escalation record alone, per the doc's acceptance
// criteria — not by re-deriving it from triage_results after the fact.
export const escalationAssessments = pgTable("escalation_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  escalationId: uuid("escalation_id").notNull().references(() => escalations.id),
  assessorId: text("assessor_id").notNull(), // "claude-triage-v1" | "gpt-triage-v1" | "rule-engine-v1"
  status: text("status").notNull(), // "completed" | "failed" (doc 13 rule 4 — ASSESSOR_FAILURE)
  classification: triageClassificationEnum("classification"), // null when status = "failed"
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  severityRank: integer("severity_rank"), // computed at consensus time — see lib/ai/consensus.ts
  observedIndicators: jsonb("observed_indicators"),
  evidence: jsonb("evidence"),
  promptVersion: text("prompt_version"),
  modelProvider: text("model_provider"),
  errorDetail: text("error_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("escalation_assessments_escalation_idx").on(t.escalationId)]);

// R7: history of every escalation state change.
export const escalationStateTransitions = pgTable("escalation_state_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  escalationId: uuid("escalation_id").notNull().references(() => escalations.id),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  fromState: escalationStateEnum("from_state"),
  toState: escalationStateEnum("to_state").notNull(),
  reason: text("reason"),
  actor: text("actor").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("escalation_transitions_escalation_idx").on(t.escalationId)]);

// Doc 14 R2 — extended to match the spec's DocumentationRecord shape.
// `symptoms`/`observations`/`followUpRequired` (doc 01's original columns,
// never referenced by any code) are superseded by the more specific
// columns below but left in place rather than dropped/renamed — keeping
// this additive avoids a data-model rename that drizzle-kit can only
// resolve via an interactive prompt this environment can't answer, the
// same reasoning behind every other schema change tonight.
export const documentationRecords = pgTable("documentation_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  callId: uuid("call_id").notNull().references(() => calls.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  summary: text("summary").notNull(), // <= 600 chars, enforced by the zod schema on write
  symptoms: jsonb("symptoms"), // superseded by patientReportedSymptoms below
  observations: jsonb("observations"), // superseded by observationsRecorded below
  outcome: text("outcome"),
  triageResultId: uuid("triage_result_id").references(() => triageResults.id),
  escalationId: uuid("escalation_id").references(() => escalations.id),
  followUpRequired: boolean("follow_up_required").notNull().default(false), // superseded by followUpActions below
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  schemaVersion: text("schema_version").notNull().default("1.0"),
  patientReportedSymptoms: jsonb("patient_reported_symptoms"), // [{symptom, severity_reported, transcript_ref}]
  observationsRecorded: jsonb("observations_recorded"), // observation ids created via record_observation
  questionsAnswered: integer("questions_answered").notNull().default(0),
  questionsTotal: integer("questions_total").notNull().default(0),
  followUpActions: jsonb("follow_up_actions"), // [{action, owner_role, due_by}]
  ehrSyncStatus: ehrSyncStatusEnum("ehr_sync_status").notNull().default("PENDING"),
  ehrSyncError: text("ehr_sync_error"),
  modelProvider: text("model_provider"),
  promptVersion: text("prompt_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("documentation_records_hospital_idx").on(t.hospitalId)]);

// ---------------------------------------------------------------------------
// Events, workflows & notifications (doc 16)
// ---------------------------------------------------------------------------
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  status: eventStatusEnum("status").notNull().default("PENDING"),
  idempotencyKey: text("idempotency_key").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("events_idempotency_key_idx").on(t.idempotencyKey),
  index("events_hospital_status_idx").on(t.hospitalId, t.status),
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  recipientUserId: uuid("recipient_user_id").references(() => users.id),
  channel: notificationChannelEnum("channel").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: notificationStatusEnum("status").notNull().default("PENDING"),
  relatedEscalationId: uuid("related_escalation_id").references(() => escalations.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notifications_hospital_idx").on(t.hospitalId)]);

// ---------------------------------------------------------------------------
// Observability (doc 19) — audit_log is append-only; see rls.sql for the
// REVOKE UPDATE, DELETE that enforces R5 at the database level.
// ---------------------------------------------------------------------------
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  reason: text("reason"),
  metadata: jsonb("metadata"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_log_hospital_idx").on(t.hospitalId)]);

export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  agent: text("agent").notNull(), // voice_intake | clinical_triage | escalation_consensus | documentation
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  purpose: text("purpose"),
  // Doc 09 §4 — written on every call so doc 21's safety eval can compare
  // report runs against the exact prompt version that produced them. Added
  // after doc 01's original schema, which predates doc 09's spec.
  promptVersion: text("prompt_version"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").notNull(),
  tokenInput: integer("token_input"),
  tokenOutput: integer("token_output"),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }),
  retryCount: integer("retry_count").notNull().default(0),
  validationOutcome: text("validation_outcome"), // "valid" | "repaired" | "failed" — doc 12's structured-output pipeline populates this
  error: text("error"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ai_usage_hospital_idx").on(t.hospitalId)]);

// ---------------------------------------------------------------------------
// Capacity (docs 06/07 — the concurrency limit the scheduler enforces)
// ---------------------------------------------------------------------------
export const hospitalCapacity = pgTable("hospital_capacity", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  maxConcurrentCalls: integer("max_concurrent_calls").notNull().default(10),
  currentActiveCalls: integer("current_active_calls").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("hospital_capacity_hospital_idx").on(t.hospitalId),
  // Doc 06 §2 — belt-and-suspenders: the claim transaction's conditional
  // UPDATE already makes over-subscription impossible under concurrency,
  // this CHECK guards against a future bug that writes the row some other
  // way (e.g. a careless doc 03 config update setting the count directly).
  check("hospital_capacity_bounds", sql`${t.currentActiveCalls} >= 0 AND ${t.currentActiveCalls} <= ${t.maxConcurrentCalls}`),
]);

// ---------------------------------------------------------------------------
// Tables that carry hospital_id and therefore are subject to RLS in rls.sql.
// Kept in one place so the SQL generator and the tests can stay in sync.
// ---------------------------------------------------------------------------
export const TENANT_TABLE_NAMES = [
  "organizations",
  "patients",
  "encounters",
  "conditions",
  "observations",
  "medications",
  "care_plans",
  "procedures",
  "communications",
  "tasks",
  "protocols",
  "knowledge_chunks",
  "campaigns",
  "outreach_tasks",
  "outreach_task_state_transitions",
  "calls",
  "call_turns",
  "triage_results",
  "escalations",
  "escalation_state_transitions",
  "escalation_assessments",
  "documentation_records",
  "events",
  "notifications",
  "audit_log",
  "ai_usage",
  "hospital_capacity",
  "user_hospital_roles",
  "escalation_contacts",
  "campaign_state_transitions",
  "eligibility_evaluations",
  "ehr_idempotency_records",
] as const;

// ---------------------------------------------------------------------------
// Mock EHR & integration boundary (doc 15)
// ---------------------------------------------------------------------------

// Doc 15 R4 — every EHR write takes an idempotency key; replaying it
// returns the original response with replayed:true instead of writing
// again. One row per key, not per call, since a caller-supplied key can
// legitimately be reused across retries of the exact same write.
export const ehrIdempotencyRecords = pgTable("ehr_idempotency_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  idempotencyKey: text("idempotency_key").notNull(),
  operation: text("operation").notNull(), // writeCommunication | writeObservation | createTask | writeEncounterNote
  responseBody: jsonb("response_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ehr_idempotency_key_idx").on(t.hospitalId, t.idempotencyKey),
  index("ehr_idempotency_hospital_idx").on(t.hospitalId),
]);
