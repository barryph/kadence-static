/**
 * Email handling for the deletion-request form.
 *
 * Validation here exists to give the user fast, useful feedback and to avoid
 * pointless network traffic. It is *not* a security control and is never used
 * to decide whether an account exists — the backend owns that decision.
 */

/** RFC 5321 maximum length of an email address. */
export const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Trims surrounding whitespace; the address is otherwise left untouched. */
export function normalizeEmail(value: string): string {
  return value.trim();
}

/**
 * Whether the value looks like a deliverable email address.
 *
 * Deliberately permissive: real-world addresses are more varied than most
 * regexes allow, and the backend (plus the verification email itself) is the
 * authoritative check.
 */
export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);

  if (!email || email.length > MAX_EMAIL_LENGTH) return false;
  if (CONTROL_CHARACTERS.test(email)) return false;
  if (email.includes('..')) return false;

  return EMAIL_PATTERN.test(email);
}
