// Doc 11 R2 — general medical discharge protocol. Demo-shaped clinical
// content, not a substitute for real hospital-authored protocols.

import type { StructuredProtocol } from "../schema";

export const GENERAL_MEDICAL_PROTOCOL: StructuredProtocol = {
  specialty: "general medicine",
  version: 1,
  effectiveFrom: "2026-01-01T00:00:00Z",
  followUpQuestions: [
    {
      id: "GEN-Q1",
      text: "How would you describe how you're feeling overall since you left the hospital?",
      answerType: "text",
      probeQuestions: [{ id: "GEN-Q1-P1", text: "Is this better, worse, or about the same as when you were discharged?" }],
    },
    {
      id: "GEN-Q2",
      text: "Have you had a fever since discharge?",
      answerType: "yes_no",
      probeQuestions: [{ id: "GEN-Q2-P1", text: "Have you taken your temperature? What was the reading?" }],
    },
    {
      id: "GEN-Q3",
      text: "Are you able to eat and drink normally?",
      answerType: "yes_no",
      probeQuestions: [{ id: "GEN-Q3-P1", text: "Have you been able to keep food and fluids down?" }],
    },
    {
      id: "GEN-Q4",
      text: "Are you taking all of your discharge medications as prescribed?",
      answerType: "yes_no",
      probeQuestions: [{ id: "GEN-Q4-P1", text: "Have you had any trouble filling your prescriptions?" }],
    },
    {
      id: "GEN-Q5",
      text: "Have you experienced any new or worsening pain?",
      answerType: "yes_no",
      probeQuestions: [{ id: "GEN-Q5-P1", text: "Where is the pain, and how severe is it on a scale of 0 to 10?" }],
    },
    {
      id: "GEN-Q6",
      text: "Have you had any nausea, vomiting, or diarrhea?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "GEN-Q7",
      text: "Do you have any questions about your discharge instructions or follow-up plan?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "GEN-Q8",
      text: "Do you have a follow-up appointment scheduled with your primary care provider or specialist?",
      answerType: "yes_no",
      probeQuestions: [{ id: "GEN-Q8-P1", text: "When is that appointment?" }],
    },
    {
      id: "GEN-Q9",
      text: "Do you have any support at home to help with your recovery?",
      answerType: "yes_no",
      probeQuestions: [],
    },
  ],
  redFlags: [
    {
      id: "GEN-RF01",
      description: "High or persistent fever",
      triggerKeywords: ["high fever", "fever won't go down", "temperature over 103", "burning up"],
      severity: "high",
      requiredAction: "Escalate for same-day clinical review.",
    },
    {
      id: "GEN-RF02",
      description: "Inability to keep food or fluids down, risk of dehydration",
      triggerKeywords: ["can't keep anything down", "vomiting everything", "can't drink water", "severe vomiting"],
      severity: "moderate",
      requiredAction: "Escalate for clinical review within 24 hours.",
    },
    {
      id: "GEN-RF03",
      description: "Severe or rapidly worsening pain",
      triggerKeywords: ["severe pain", "worst pain", "pain is unbearable", "pain getting much worse"],
      severity: "high",
      requiredAction: "Advise immediate emergency evaluation if pain is severe and new.",
    },
    {
      id: "GEN-RF04",
      description: "Signs of confusion or altered mental status",
      triggerKeywords: ["confused", "not making sense", "disoriented", "can't think clearly"],
      severity: "high",
      requiredAction: "Advise immediate emergency evaluation.",
    },
    {
      id: "GEN-RF05",
      description: "Medication access or adherence problems",
      triggerKeywords: ["couldn't fill my prescription", "can't afford medication", "haven't started my medication"],
      severity: "moderate",
      requiredAction: "Escalate for pharmacist or care coordinator follow-up.",
    },
    {
      id: "GEN-RF06",
      description: "Persistent diarrhea or vomiting lasting more than 24 hours",
      triggerKeywords: ["diarrhea for two days", "vomiting all day", "can't stop vomiting"],
      severity: "moderate",
      requiredAction: "Escalate for clinical review within 24 hours.",
    },
    {
      id: "GEN-RF07",
      description: "No follow-up appointment scheduled or unclear discharge instructions",
      triggerKeywords: ["don't have an appointment", "don't understand my instructions", "no follow-up scheduled"],
      severity: "low",
      requiredAction: "Assist with scheduling and clarify instructions; escalate if patient remains unable to proceed.",
    },
  ],
  approvedGuidance: [
    {
      id: "GEN-G1",
      topic: "Medication adherence",
      text: "Take all discharge medications exactly as prescribed, and contact your pharmacy or care team promptly if you have trouble filling any prescription.",
    },
    {
      id: "GEN-G2",
      topic: "Follow-up care",
      text: "Attend your scheduled follow-up appointment, and bring a list of any new or ongoing symptoms to discuss with your provider.",
    },
    {
      id: "GEN-G3",
      topic: "Hydration and nutrition",
      text: "Continue eating and drinking as tolerated, following any specific dietary instructions given at discharge.",
    },
  ],
  escalationRules: [
    { id: "GEN-ER1", condition: "Any high-severity red flag matched", priority: "high" },
    { id: "GEN-ER2", condition: "Any moderate-severity red flag matched", priority: "medium" },
    { id: "GEN-ER3", condition: "Patient reports not understanding discharge instructions", priority: "low" },
  ],
};
