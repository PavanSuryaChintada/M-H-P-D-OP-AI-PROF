// Doc 10 R2 — deterministic, keyword-based safety detectors that run on
// every patient turn, independent of whatever the conversational layer
// does. Same reasoning as doc 13's rule engine being a third, independent
// voter: a scripted intake flow can still get an emergency phrase wrong if
// safety depended entirely on it recognizing the phrase in the moment, so
// this is a structural check the flow cannot skip, not a suggestion to an
// LLM that could be talked out of it by the patient's own words (which are
// untrusted input per doc 02 — this is exactly the kind of check that must
// not be overridable by anything the patient says).

const EMERGENCY_KEYWORDS = [
  "chest pain",
  "chest pressure",
  "can't breathe",
  "cannot breathe",
  "difficulty breathing",
  "shortness of breath at rest",
  "passed out",
  "fainted",
  "severe bleeding",
  "call an ambulance",
  "call 911",
  "emergency",
];

const ADVICE_REQUEST_KEYWORDS = [
  "what should i do",
  "should i take",
  "should i stop taking",
  "is it okay to",
  "can i take",
  "what medication should",
  "what dose should",
  "do i have",
  "what's wrong with me",
  "what is wrong with me",
];

function containsAny(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

export function detectEmergency(patientUtterance: string): { triggered: boolean; matchedKeyword?: string } {
  const match = containsAny(patientUtterance, EMERGENCY_KEYWORDS);
  return match ? { triggered: true, matchedKeyword: match } : { triggered: false };
}

export function detectAdviceRequest(patientUtterance: string): { triggered: boolean; matchedKeyword?: string } {
  const match = containsAny(patientUtterance, ADVICE_REQUEST_KEYWORDS);
  return match ? { triggered: true, matchedKeyword: match } : { triggered: false };
}

/** Doc 10 R1 step 1 — identity verification fails; the call must not proceed to any clinical content. */
export function detectWrongPerson(patientUtterance: string): boolean {
  return containsAny(patientUtterance, ["wrong number", "wrong person", "no one here by that name", "you have the wrong"]) !== null;
}

/** Doc 10 R1 step 3 — the patient declines to continue the call at all. */
export function detectRefusal(patientUtterance: string): boolean {
  return containsAny(patientUtterance, ["i don't want to answer", "i'd rather not", "not interested", "please stop calling", "leave me alone"]) !== null;
}

/** Doc 10 R1 step 3 — now is not convenient, but the patient isn't refusing outright. */
export function detectNotConvenient(patientUtterance: string): boolean {
  return containsAny(patientUtterance, ["not a good time", "can you call back", "call me later", "call me tomorrow", "busy right now"]) !== null;
}

/** Doc 10 R2's scripted refusal, verbatim. */
export function buildAdviceRefusal(hospitalName: string): string {
  return `I'm not able to advise on that — I'll have a nurse from ${hospitalName} follow up with you.`;
}
