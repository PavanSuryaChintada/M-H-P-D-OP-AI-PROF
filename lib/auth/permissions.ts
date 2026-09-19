// Doc 02 R2 — permission matrix as data, not scattered ifs. Every route
// handler calls can()/requireAllowed() instead of hand-rolling role checks.

import type { Role } from "../db/tenant";

export type { Role };

export type Action =
  | "hospital:create"
  | "hospital:read" // not in the PRD §3 table verbatim — every role that
  // resolves a TenantContext at all needs to read that hospital's basic
  // info, so this exists as necessary plumbing rather than a new feature.
  // Membership itself is already gated by resolveTenantContext(); this only
  // decides whether a resolved role may read hospital metadata.
  | "hospital:manage_users"
  | "hospital:configure" // doc 03 R1/R2 — operating config, escalation
  // contacts, readiness/status changes. Same PA-only scope as
  // hospital:create per doc 03's own spec ("CRUD for hospitals,
  // restricted to PLATFORM_ADMIN"), kept as a separate action rather
  // than reusing hospital:create so a PATCH isn't gated by an action
  // named for POST.
  | "discharge:upload"
  | "protocol:manage"
  | "campaign:manage" // create / start / pause
  | "queue:view"
  | "patient:view_clinical"
  | "escalation:resolve"
  | "escalation:view" // doc 17 R5 — the reviewer work queue and review screen. Narrower than queue:view: CAMPAIGN_MANAGER sees the call queue but not clinical escalation content.
  | "escalation:assign" // doc 17 R3 — acknowledge/assign/reassign/request-info/create-followup-task: lower stakes than resolve, but still not open to CAMPAIGN_MANAGER.
  | "hospital:view_dashboard" // doc 18 R2 — the Hospital Admin dashboard (escalation counts, EHR health, reviewer stats). HOSPITAL_ADMIN only, unlike hospital:read which every role needs just to resolve a TenantContext at all.
  | "analytics:platform_aggregate";

/**
 * true/false — plain allow/deny.
 * "audited" — allowed, but the caller MUST write an audit_log entry with a
 *   reason before returning data (doc 02 R3 — Platform Admin on patient
 *   clinical records).
 * "limited" — allowed, but the caller must apply a narrower field/data view
 *   than the full-access case (Campaign Manager on patient clinical detail).
 */
type Grant = boolean | "audited" | "limited";

const ROLES: Role[] = [
  "PLATFORM_ADMIN",
  "HOSPITAL_ADMIN",
  "CAMPAIGN_MANAGER",
  "CLINICAL_REVIEWER",
];

// PRD §3 permission table, transcribed as data.
const MATRIX: Record<Action, Record<Role, Grant>> = {
  "hospital:create": {
    PLATFORM_ADMIN: true,
    HOSPITAL_ADMIN: false,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: false,
  },
  "hospital:read": {
    PLATFORM_ADMIN: true,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: true,
    CLINICAL_REVIEWER: true,
  },
  "hospital:configure": {
    PLATFORM_ADMIN: true,
    HOSPITAL_ADMIN: false,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: false,
  },
  "hospital:manage_users": {
    PLATFORM_ADMIN: true,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: false,
  },
  "discharge:upload": {
    PLATFORM_ADMIN: false,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: false,
  },
  "protocol:manage": {
    PLATFORM_ADMIN: false,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: false,
  },
  "campaign:manage": {
    PLATFORM_ADMIN: false,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: true,
    CLINICAL_REVIEWER: false,
  },
  "queue:view": {
    PLATFORM_ADMIN: false,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: true,
    CLINICAL_REVIEWER: true,
  },
  "patient:view_clinical": {
    PLATFORM_ADMIN: "audited",
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: "limited",
    CLINICAL_REVIEWER: true,
  },
  "escalation:resolve": {
    PLATFORM_ADMIN: false,
    HOSPITAL_ADMIN: false,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: true,
  },
  "escalation:view": {
    PLATFORM_ADMIN: false,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: true,
  },
  "escalation:assign": {
    PLATFORM_ADMIN: false,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: true,
  },
  "hospital:view_dashboard": {
    PLATFORM_ADMIN: false,
    HOSPITAL_ADMIN: true,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: false,
  },
  "analytics:platform_aggregate": {
    PLATFORM_ADMIN: true,
    HOSPITAL_ADMIN: false,
    CAMPAIGN_MANAGER: false,
    CLINICAL_REVIEWER: false,
  },
};

export function can(role: Role, action: Action): Grant {
  return MATRIX[action][role];
}

export function isAllowed(role: Role, action: Action): boolean {
  return can(role, action) !== false;
}

export class ForbiddenError extends Error {
  constructor(action: Action, role: Role) {
    super(`role ${role} is not permitted to ${action}`);
    this.name = "ForbiddenError";
  }
}

/** Throws ForbiddenError (route handlers map this to 403) if role can't perform action. */
export function requireAllowed(role: Role, action: Action): Grant {
  const grant = can(role, action);
  if (grant === false) throw new ForbiddenError(action, role);
  return grant;
}

// Self-check: every action must have an entry for every role, so a typo in
// the matrix fails fast instead of silently defaulting to "denied".
for (const action of Object.keys(MATRIX) as Action[]) {
  for (const role of ROLES) {
    if (!(role in MATRIX[action])) {
      throw new Error(`permissions matrix missing ${role} for action ${action}`);
    }
  }
}
