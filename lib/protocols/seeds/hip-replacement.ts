// Doc 11 R2 — post-surgical protocol (hip replacement / total hip
// arthroplasty). Demo-shaped clinical content, not a substitute for real
// hospital-authored protocols — written to be realistic in structure and
// terminology for the purposes of this build, not clinically certified.

import type { StructuredProtocol } from "../schema";

export const HIP_REPLACEMENT_PROTOCOL: StructuredProtocol = {
  specialty: "orthopedic surgery",
  version: 1,
  effectiveFrom: "2026-01-01T00:00:00Z",
  followUpQuestions: [
    {
      id: "HIP-Q1",
      text: "On a scale of 0 to 10, how would you rate your hip pain right now?",
      answerType: "scale",
      probeQuestions: [
        { id: "HIP-Q1-P1", text: "Is the pain worse than yesterday?" },
        { id: "HIP-Q1-P2", text: "Does the pain wake you at night?" },
      ],
    },
    {
      id: "HIP-Q2",
      text: "Have you noticed any redness, warmth, or swelling around the incision site?",
      answerType: "yes_no",
      probeQuestions: [{ id: "HIP-Q2-P1", text: "Has the swelling spread beyond the incision itself?" }],
    },
    {
      id: "HIP-Q3",
      text: "Is there any drainage or fluid coming from the incision?",
      answerType: "yes_no",
      probeQuestions: [{ id: "HIP-Q3-P1", text: "What color is the drainage — clear, yellow, or bloody?" }],
    },
    {
      id: "HIP-Q4",
      text: "Have you had a fever or felt feverish since discharge?",
      answerType: "yes_no",
      probeQuestions: [{ id: "HIP-Q4-P1", text: "Have you taken your temperature? What was the reading?" }],
    },
    {
      id: "HIP-Q5",
      text: "Are you able to bear weight on the operated leg as instructed?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "HIP-Q6",
      text: "Have you noticed any swelling, warmth, or tenderness in your calf on either leg?",
      answerType: "yes_no",
      probeQuestions: [{ id: "HIP-Q6-P1", text: "Is the calf swelling on one side only?" }],
    },
    {
      id: "HIP-Q7",
      text: "Are you experiencing any shortness of breath or chest pain?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "HIP-Q8",
      text: "Are you taking your blood thinner medication as prescribed?",
      answerType: "yes_no",
      probeQuestions: [{ id: "HIP-Q8-P1", text: "Have you missed any doses?" }],
    },
    {
      id: "HIP-Q9",
      text: "Are you using your walker or crutches as instructed by physical therapy?",
      answerType: "yes_no",
      probeQuestions: [],
    },
    {
      id: "HIP-Q10",
      text: "Do you have any numbness or tingling in your foot or toes on the operated side?",
      answerType: "yes_no",
      probeQuestions: [],
    },
  ],
  redFlags: [
    {
      id: "HIP-RF01",
      description: "Signs of deep vein thrombosis — calf swelling, warmth, or tenderness",
      triggerKeywords: ["calf swelling", "calf pain", "leg swelling", "warm calf", "tender calf"],
      severity: "high",
      requiredAction: "Advise immediate emergency evaluation; do not wait for a scheduled follow-up.",
    },
    {
      id: "HIP-RF02",
      description: "Signs of pulmonary embolism — sudden shortness of breath or chest pain",
      triggerKeywords: ["shortness of breath", "can't breathe", "chest pain", "difficulty breathing"],
      severity: "high",
      requiredAction: "Advise the patient to call emergency services immediately.",
    },
    {
      id: "HIP-RF03",
      description: "Surgical site infection — spreading redness, warmth, or purulent drainage",
      triggerKeywords: ["pus", "spreading redness", "foul smell", "yellow drainage", "wound infection"],
      severity: "high",
      requiredAction: "Escalate for same-day clinical review.",
    },
    {
      id: "HIP-RF04",
      description: "Fever suggestive of systemic infection",
      triggerKeywords: ["fever", "chills", "temperature over 101", "feverish"],
      severity: "moderate",
      requiredAction: "Escalate for clinical review within 24 hours.",
    },
    {
      id: "HIP-RF05",
      description: "Hip dislocation symptoms — sudden severe pain with inability to bear weight or leg appearing shortened/rotated",
      triggerKeywords: ["popped out", "leg looks different", "can't move my leg", "sudden severe pain"],
      severity: "high",
      requiredAction: "Advise immediate emergency evaluation.",
    },
    {
      id: "HIP-RF06",
      description: "Uncontrolled pain not responding to prescribed medication",
      triggerKeywords: ["pain not going away", "medication isn't working", "pain getting worse"],
      severity: "moderate",
      requiredAction: "Escalate for medication review.",
    },
    {
      id: "HIP-RF07",
      description: "New numbness or weakness in the operated leg or foot",
      triggerKeywords: ["numbness", "tingling", "foot drop", "can't feel my foot"],
      severity: "moderate",
      requiredAction: "Escalate for clinical review within 24 hours.",
    },
  ],
  approvedGuidance: [
    {
      id: "HIP-G1",
      topic: "Hip precautions",
      text: "Continue to avoid bending your hip past 90 degrees, crossing your legs, and turning your operated leg inward, as instructed by your surgical team, until your follow-up appointment.",
    },
    {
      id: "HIP-G2",
      topic: "Weight-bearing",
      text: "Follow the weight-bearing instructions given by your physical therapist and surgical team exactly — do not increase weight-bearing on your own.",
    },
    {
      id: "HIP-G3",
      topic: "Incision care",
      text: "Keep the incision clean and dry, and follow the dressing-change instructions provided at discharge.",
    },
  ],
  escalationRules: [
    { id: "HIP-ER1", condition: "Any high-severity red flag matched", priority: "high" },
    { id: "HIP-ER2", condition: "Any moderate-severity red flag matched", priority: "medium" },
    { id: "HIP-ER3", condition: "Pain score reported as 8 or above", priority: "medium" },
  ],
};
