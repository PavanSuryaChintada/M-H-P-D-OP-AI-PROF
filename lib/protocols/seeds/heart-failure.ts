// Doc 11 R2 — cardiac protocol (heart failure discharge). Demo-shaped
// clinical content, not a substitute for real hospital-authored
// protocols.

import type { StructuredProtocol } from "../schema";

export const HEART_FAILURE_PROTOCOL: StructuredProtocol = {
  specialty: "cardiology",
  version: 1,
  effectiveFrom: "2026-01-01T00:00:00Z",
  followUpQuestions: [
    {
      id: "HF-Q1",
      text: "Have you weighed yourself today, and if so, what was your weight?",
      answerType: "text",
      probeQuestions: [{ id: "HF-Q1-P1", text: "How does that compare to your weight at discharge?" }],
    },
    {
      id: "HF-Q2",
      text: "Have you noticed any swelling in your legs, ankles, or feet?",
      answerType: "yes_no",
      probeQuestions: [{ id: "HF-Q2-P1", text: "Is the swelling worse than when you left the hospital?" }],
    },
    {
      id: "HF-Q3",
      text: "Are you more short of breath than usual, especially when lying flat or during activity?",
      answerType: "yes_no",
      probeQuestions: [{ id: "HF-Q3-P1", text: "How many pillows do you need to sleep comfortably?" }],
    },
    {
      id: "HF-Q4",
      text: "Have you had any chest pain, pressure, or tightness?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "HF-Q5",
      text: "Are you taking all of your heart medications exactly as prescribed?",
      answerType: "yes_no",
      probeQuestions: [{ id: "HF-Q5-P1", text: "Have you missed any doses since discharge?" }],
    },
    {
      id: "HF-Q6",
      text: "Are you following the low-sodium diet recommended by your care team?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "HF-Q7",
      text: "Have you had any episodes of a rapid or irregular heartbeat?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "HF-Q8",
      text: "Have you felt unusually tired or fatigued compared to your normal baseline?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "HF-Q9",
      text: "Have you had any dizziness or lightheadedness, especially when standing up?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "HF-Q10",
      text: "Do you have a follow-up cardiology appointment scheduled, and do you know when it is?",
      answerType: "yes_no",
      probeQuestions: [],
    },
  ],
  redFlags: [
    {
      id: "HF-RF01",
      description: "Rapid weight gain suggestive of fluid retention — more than 2kg in 3 days",
      triggerKeywords: ["gained two kilos", "weight gain", "gained a lot of weight", "gaining weight fast"],
      severity: "high",
      requiredAction: "Escalate for same-day clinical review — likely diuretic adjustment needed.",
    },
    {
      id: "HF-RF02",
      description: "Worsening shortness of breath, especially at rest or when lying flat",
      triggerKeywords: ["can't breathe lying down", "short of breath at rest", "gasping for air", "trouble breathing"],
      severity: "high",
      requiredAction: "Advise immediate emergency evaluation.",
    },
    {
      id: "HF-RF03",
      description: "Chest pain or pressure",
      triggerKeywords: ["chest pain", "chest pressure", "chest tightness"],
      severity: "high",
      requiredAction: "Advise the patient to call emergency services immediately.",
    },
    {
      id: "HF-RF04",
      description: "Significant new or worsening peripheral edema",
      triggerKeywords: ["swelling in my legs", "ankle swelling", "feet are swollen", "legs are swollen"],
      severity: "moderate",
      requiredAction: "Escalate for clinical review within 24 hours.",
    },
    {
      id: "HF-RF05",
      description: "Syncope or near-syncope (fainting or near-fainting)",
      triggerKeywords: ["fainted", "passed out", "almost fainted", "blacked out"],
      severity: "high",
      requiredAction: "Advise immediate emergency evaluation.",
    },
    {
      id: "HF-RF06",
      description: "Palpitations or irregular heartbeat",
      triggerKeywords: ["heart racing", "irregular heartbeat", "heart skipping", "palpitations"],
      severity: "moderate",
      requiredAction: "Escalate for clinical review within 24 hours.",
    },
    {
      id: "HF-RF07",
      description: "Medication non-adherence — missed diuretic or heart failure medication doses",
      triggerKeywords: ["missed my medication", "ran out of medication", "stopped taking", "forgot my pills"],
      severity: "moderate",
      requiredAction: "Escalate for pharmacist or nurse follow-up.",
    },
    {
      id: "HF-RF08",
      description: "Persistent dizziness or lightheadedness on standing",
      triggerKeywords: ["dizzy", "lightheaded", "dizziness when standing"],
      severity: "low",
      requiredAction: "Note for review at next scheduled follow-up; escalate if worsening.",
    },
  ],
  approvedGuidance: [
    {
      id: "HF-G1",
      topic: "Daily weight monitoring",
      text: "Weigh yourself every morning after using the bathroom and before eating, using the same scale, and record it in your log.",
    },
    {
      id: "HF-G2",
      topic: "Sodium restriction",
      text: "Continue following the low-sodium diet plan provided by your care team — aim to avoid processed and highly salted foods.",
    },
    {
      id: "HF-G3",
      topic: "Medication adherence",
      text: "Take your heart failure medications at the same time every day, and do not stop any medication without speaking to your care team first.",
    },
  ],
  escalationRules: [
    { id: "HF-ER1", condition: "Any high-severity red flag matched", priority: "high" },
    { id: "HF-ER2", condition: "Any moderate-severity red flag matched", priority: "medium" },
    { id: "HF-ER3", condition: "Weight gain reported without other symptoms", priority: "medium" },
  ],
};
