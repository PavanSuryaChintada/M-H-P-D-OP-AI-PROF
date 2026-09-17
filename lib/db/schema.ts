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
  "RETRY_SCHEDULED",
  "CALLBACK_SCHEDULED",
  "ESCALATED",
  "MANUAL_FOLLOW_UP",
  "FAILED",
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
  "TECHNICAL_FAILURE",
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

// ---------------------------------------------------------------------------
// Core tenancy
// ---------------------------------------------------------------------------
export const hospitals = pgTable("hospitals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  status: text("status").notNull().default("DRAFT"), // DRAFT | READY | ACTIVE — extended by doc 03
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  authProviderId: text("auth_provider_id"), // Supabase Auth user id
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

export const encounters = pgTable("encounters", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  careSetting: text("care_setting"),
  admissionAt: timestamp("admission_at", { withTimezone: true }),
  dischargeAt: timestamp("discharge_at", { withTimezone: true }),
  dischargeInstructions: text("discharge_instructions"),
  fhirResourceType: text("fhir_resource_type").notNull().default("Encounter"),
  sourcePayload: jsonb("source_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("encounters_hospital_idx").on(t.hospitalId),
  index("encounters_patient_idx").on(t.patientId),
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
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
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
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("campaigns_hospital_idx").on(t.hospitalId)]);

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // R6: the scheduler's claim query filters on exactly these columns.
  index("outreach_tasks_hospital_state_scheduled_idx").on(t.hospitalId, t.state, t.scheduledFor),
  index("outreach_tasks_campaign_state_idx").on(t.campaignId, t.state),
  index("outreach_tasks_active_partial_idx")
    .on(t.hospitalId, t.state)
    .where(sql`${t.state} IN ('PENDING','SCHEDULED','CALLING','RETRY_SCHEDULED','CALLBACK_SCHEDULED')`),
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
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  outcome: callOutcomeEnum("outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("calls_hospital_idx").on(t.hospitalId),
  index("calls_outreach_task_idx").on(t.outreachTaskId),
]);

export const callTurns = pgTable("call_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").notNull().references(() => calls.id),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  turnIndex: integer("turn_index").notNull(),
  speaker: text("speaker").notNull(), // AGENT | PATIENT
  content: text("content").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("triage_results_hospital_idx").on(t.hospitalId)]);

export const escalations = pgTable("escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  callId: uuid("call_id").references(() => calls.id),
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
]);

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

export const documentationRecords = pgTable("documentation_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitals.id),
  callId: uuid("call_id").notNull().references(() => calls.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  summary: text("summary").notNull(),
  symptoms: jsonb("symptoms"),
  observations: jsonb("observations"),
  outcome: text("outcome"),
  triageResultId: uuid("triage_result_id").references(() => triageResults.id),
  escalationId: uuid("escalation_id").references(() => escalations.id),
  followUpRequired: boolean("follow_up_required").notNull().default(false),
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
  latencyMs: integer("latency_ms"),
  success: boolean("success").notNull(),
  tokenInput: integer("token_input"),
  tokenOutput: integer("token_output"),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }),
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
}, (t) => [uniqueIndex("hospital_capacity_hospital_idx").on(t.hospitalId)]);

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
  "documentation_records",
  "events",
  "notifications",
  "audit_log",
  "ai_usage",
  "hospital_capacity",
  "user_hospital_roles",
] as const;
