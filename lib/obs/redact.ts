// Doc 02 R6 — data minimisation in logs. Strip names, phone numbers, DOB,
// email and free-text address from any object before it reaches a logger.
// Patients should be logged by id only.

const PHI_KEYS = new Set([
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "name",
  "fullName",
  "displayName",
  "display_name",
  "dob",
  "dateOfBirth",
  "date_of_birth",
  "phone",
  "phoneNumber",
  "phone_number",
  "email",
  "address",
  "mrn",
]);

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE_RE = /\+?\d[\d\-\s()]{7,}\d/g;

/** Deep-redacts known PHI keys and scrubs email/phone-shaped substrings out of free text. */
export function redact<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value
      .replace(EMAIL_RE, "[REDACTED_EMAIL]")
      .replace(PHONE_RE, "[REDACTED_PHONE]") as unknown as T;
  }

  if (typeof value !== "object") return value;

  if (seen.has(value as object)) return "[CIRCULAR]" as unknown as T;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, seen)) as unknown as T;
  }

  if (value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = PHI_KEYS.has(key) ? "[REDACTED]" : redact(val, seen);
  }
  return out as T;
}
