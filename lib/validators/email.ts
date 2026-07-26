import { z } from "zod"

/**
 * Canonical email handling. Every email that enters the system goes through
 * here, so a stored address always matches what an auth lookup will search
 * for.
 *
 * ── Why this exists ────────────────────────────────────────────────
 * On 2026-07-26 an admin-created account was completely unreachable. The
 * address was stored as typed — `Vick.Kumar19@gmail.com` — but better-auth's
 * `findUserByEmail` lowercases its input and matches exactly against a plain
 * `text` column:
 *
 *     SELECT ... WHERE email = 'vick.kumar19@gmail.com'   -> 0 rows
 *     SELECT ... WHERE lower(email) = 'vick...'           -> 1 row
 *
 * So sign-in couldn't find the user, and neither could password reset —
 * which fails SILENTLY by design, to avoid leaking whether an account
 * exists. The account existed, held an admin role, and could not be used or
 * recovered by any route.
 *
 * ── The rule ───────────────────────────────────────────────────────
 * Normalize at the VALIDATION boundary, not at each call site. Every schema
 * that accepts an email uses the helpers below, so actions receive
 * already-normalized values and cannot forget. `normalizeEmail` exists for
 * the few boundaries that don't parse through zod (direct DB writes, calls
 * into better-auth). Enforced by
 * `lib/validators/__tests__/email-normalization-scanner.test.ts`.
 *
 * ── Ordering matters ───────────────────────────────────────────────
 * `z.email().trim().toLowerCase()` is WRONG: zod validates before it
 * transforms, so a pasted address with a trailing space fails with
 * "Invalid email" instead of being cleaned. Trim and lowercase FIRST, then
 * validate — that's what the pipe below does.
 *
 * Note: only the domain is case-insensitive per RFC 5321; the local part
 * technically is not. Every mail provider we care about treats it
 * case-insensitively, and better-auth lowercases the whole address, so
 * matching that behaviour is what keeps lookups working.
 */

/** Lowercase + trim a raw address. Use at non-zod boundaries. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Required email. Trims and lowercases before validating. */
export function emailSchema(message = "Enter a valid email address") {
  return z.string().trim().toLowerCase().pipe(z.email(message))
}

/**
 * Optional email that also accepts "" — the shape the settings and vendor
 * forms submit when a contact address is cleared.
 */
export function optionalEmailSchema(message = "Enter a valid email address") {
  return z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.union([z.email(message), z.literal("")]))
    .optional()
}

/** A list of recipient addresses (e.g. ReportSchedule.emailRecipients). */
export function emailListSchema(message = "Enter a valid email address") {
  return z.array(emailSchema(message))
}
