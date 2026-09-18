// Doc 05 R5 — eligibility as an explainable rule engine. Each rule is a
// pure function so it can be unit tested in isolation without a database.

export interface RuleResult {
  ruleId: string;
  passed: boolean;
  reason: string;
  evidence?: unknown;
}

export interface EligibilityCriteria {
  riskLevels?: ("LOW" | "MEDIUM" | "HIGH" | "CRITICAL")[];
  conditionCodes?: string[];
  careSettings?: string[];
  conflictsWithCampaignIds?: string[];
}

export interface EligibilityPatient {
  id: string;
  phone: string | null;
  communicationPreferences?: { doNotContact?: boolean } | null;
  sourcePayload?: { deceased?: boolean; readmitted?: boolean } | null;
}

export interface EligibilityEncounter {
  dischargeAt: Date;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  careSetting: string | null;
  followUpWindowHours: number | null;
}

export interface EligibilityCondition {
  codeText: string;
}

export interface ExistingTask {
  campaignId: string;
  state: string;
}

export interface EligibilityInput {
  patient: EligibilityPatient;
  encounter: EligibilityEncounter;
  conditions: EligibilityCondition[];
  campaignId: string;
  criteria: EligibilityCriteria;
  now: Date;
  /** every outreach_task this patient currently has, across all campaigns at this hospital (empty until doc 06 exists — rules that read it simply never fire yet). */
  existingTasks: ExistingTask[];
}

export type EligibilityRule = (input: EligibilityInput) => RuleResult;

const TERMINAL_TASK_STATES = new Set(["COMPLETED", "FAILED"]);
const ACTIVE_TASK_STATES = new Set([
  "PENDING",
  "SCHEDULED",
  "CALLING",
  "CONNECTED",
  "RETRY_SCHEDULED",
  "CALLBACK_SCHEDULED",
]);

const INVALID_PHONE_SENTINEL = "000-000-0000";

export const rules: Record<string, EligibilityRule> = {
  dischargedWithinWindow: (i) => {
    const windowHours = i.encounter.followUpWindowHours ?? 0;
    const deadline = new Date(i.encounter.dischargeAt.getTime() + windowHours * 60 * 60 * 1000);
    const passed = deadline.getTime() > i.now.getTime();
    return {
      ruleId: "dischargedWithinWindow",
      passed,
      reason: passed ? "follow-up window still open" : "follow-up window has expired",
      evidence: { dischargeAt: i.encounter.dischargeAt, windowHours, deadline },
    };
  },

  dischargeStatusValid: (i) => {
    const passed = i.encounter.dischargeAt != null;
    return {
      ruleId: "dischargeStatusValid",
      passed,
      reason: passed ? "discharge recorded" : "no discharge timestamp on record",
    };
  },

  notDeceasedOrReadmitted: (i) => {
    const deceased = i.patient.sourcePayload?.deceased === true;
    const readmitted = i.patient.sourcePayload?.readmitted === true;
    const passed = !deceased && !readmitted;
    return {
      ruleId: "notDeceasedOrReadmitted",
      passed,
      reason: deceased ? "patient recorded as deceased" : readmitted ? "patient has been readmitted" : "no deceased/readmitted flag",
      evidence: { deceased, readmitted },
    };
  },

  hasUsableContact: (i) => {
    const digits = (i.patient.phone ?? "").replace(/\D/g, "");
    const passed = digits.length >= 10 && i.patient.phone !== INVALID_PHONE_SENTINEL;
    return {
      ruleId: "hasUsableContact",
      passed,
      reason: passed ? "usable phone number on file" : "no usable phone number",
      evidence: { phone: i.patient.phone },
    };
  },

  consentAllowsContact: (i) => {
    const passed = i.patient.communicationPreferences?.doNotContact !== true;
    return {
      ruleId: "consentAllowsContact",
      passed,
      reason: passed ? "no do-not-contact flag" : "patient opted out of contact",
    };
  },

  notAlreadyCompletedInCampaign: (i) => {
    const completed = i.existingTasks.some((t) => t.campaignId === i.campaignId && t.state === "COMPLETED");
    return {
      ruleId: "notAlreadyCompletedInCampaign",
      passed: !completed,
      reason: completed ? "already completed outreach in this campaign" : "not yet completed in this campaign",
    };
  },

  notInConflictingActiveCampaign: (i) => {
    const conflictIds = new Set(i.criteria.conflictsWithCampaignIds ?? []);
    const conflict = i.existingTasks.find(
      (t) => conflictIds.has(t.campaignId) && ACTIVE_TASK_STATES.has(t.state) && !TERMINAL_TASK_STATES.has(t.state),
    );
    return {
      ruleId: "notInConflictingActiveCampaign",
      passed: !conflict,
      reason: conflict ? `active task in conflicting campaign ${conflict.campaignId}` : "no configured campaign conflicts active",
      evidence: { conflictIds: [...conflictIds] },
    };
  },

  matchesCampaignCriteria: (i) => {
    const reasons: string[] = [];
    let passed = true;

    if (i.criteria.riskLevels && i.criteria.riskLevels.length > 0) {
      const ok = i.encounter.riskLevel != null && i.criteria.riskLevels.includes(i.encounter.riskLevel);
      if (!ok) {
        passed = false;
        reasons.push(`risk level ${i.encounter.riskLevel} not in ${i.criteria.riskLevels.join(",")}`);
      }
    }
    if (i.criteria.careSettings && i.criteria.careSettings.length > 0) {
      const ok = i.encounter.careSetting != null && i.criteria.careSettings.includes(i.encounter.careSetting);
      if (!ok) {
        passed = false;
        reasons.push(`care setting ${i.encounter.careSetting} not in ${i.criteria.careSettings.join(",")}`);
      }
    }
    if (i.criteria.conditionCodes && i.criteria.conditionCodes.length > 0) {
      const patientCodes = new Set(i.conditions.map((c) => c.codeText));
      const ok = i.criteria.conditionCodes.some((code) => patientCodes.has(code));
      if (!ok) {
        passed = false;
        reasons.push(`no condition matches ${i.criteria.conditionCodes.join(",")}`);
      }
    }

    return {
      ruleId: "matchesCampaignCriteria",
      passed,
      reason: passed ? "matches campaign criteria" : reasons.join("; "),
      evidence: { criteria: i.criteria, conditions: i.conditions.map((c) => c.codeText) },
    };
  },
};

export const RULE_ORDER = [
  "dischargedWithinWindow",
  "dischargeStatusValid",
  "notDeceasedOrReadmitted",
  "hasUsableContact",
  "consentAllowsContact",
  "notAlreadyCompletedInCampaign",
  "notInConflictingActiveCampaign",
  "matchesCampaignCriteria",
] as const;

/** Runs every rule (even after a failure — R5 wants the full breakdown, not just the first failing rule) and returns ELIGIBLE only if all pass. Throws if a rule itself throws — the caller (lib/campaigns/evaluate.ts) is what turns that into an ERROR status, never a silent exclusion (R6). */
export function evaluateAllRules(input: EligibilityInput): RuleResult[] {
  return RULE_ORDER.map((ruleId) => rules[ruleId](input));
}
