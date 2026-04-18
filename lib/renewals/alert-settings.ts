/**
 * Pure renewal alert-settings validator + normalizer.
 *
 * Renewal alert settings are user-provided configuration that drives the
 * renewal alert engine (see `lib/renewals/engine.ts`). This module is the sole
 * gatekeeper between untrusted input (API bodies, form submissions, JSON blobs
 * loaded from the database) and the trusted settings struct consumed by the
 * engine.
 *
 * ─── Rules ──────────────────────────────────────────────────────────
 *
 *   renewalReminderDaysBefore
 *     - non-empty array
 *     - every entry is a positive integer
 *     - max length 5
 *     - duplicates rejected
 *     - auto-sorted descending
 *
 *   expirationAlertDays
 *     - positive integer
 *     - max 365
 *
 *   includeUnderperformingContracts, includeOverperformingContracts
 *     - booleans
 *
 *   notifyChannels
 *     - non-empty array
 *     - every entry is one of "email" | "in_app" | "slack"
 *     - duplicates deduped (order preserved, first occurrence wins)
 *
 * Any violation throws `RenewalAlertSettingsValidationError` with the offending
 * field and a human-readable reason. Missing required fields throw the same
 * error (one per missing field on first discovery).
 *
 * This module is pure. No DB, no I/O.
 */

export interface RenewalAlertSettingsInput {
  renewalReminderDaysBefore: number[]
  expirationAlertDays: number
  includeUnderperformingContracts: boolean
  includeOverperformingContracts: boolean
  notifyChannels: Array<"email" | "in_app" | "slack">
}

export interface ValidatedRenewalAlertSettings {
  renewalReminderDaysBefore: number[]
  expirationAlertDays: number
  includeUnderperformingContracts: boolean
  includeOverperformingContracts: boolean
  notifyChannels: Array<"email" | "in_app" | "slack">
}

export class RenewalAlertSettingsValidationError extends Error {
  constructor(
    public field: string,
    public reason: string,
  ) {
    super(`Invalid alert settings: ${field} — ${reason}`)
    this.name = "RenewalAlertSettingsValidationError"
  }
}

const VALID_CHANNELS = ["email", "in_app", "slack"] as const
type NotifyChannel = (typeof VALID_CHANNELS)[number]

const MAX_REMINDERS = 5
const MAX_EXPIRATION_ALERT_DAYS = 365

/**
 * Validate and normalize raw renewal alert-settings input.
 *
 * Returns a new object with: reminders sorted descending, channels deduped
 * (first-wins order preserved). Throws on any violation.
 */
export function validateRenewalAlertSettings(
  input: unknown,
): ValidatedRenewalAlertSettings {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new RenewalAlertSettingsValidationError(
      "input",
      "expected an object",
    )
  }

  const record = input as Record<string, unknown>

  const reminders = validateReminders(record.renewalReminderDaysBefore)
  const expirationAlertDays = validateExpirationAlertDays(
    record.expirationAlertDays,
  )
  const includeUnderperformingContracts = validateBoolean(
    record.includeUnderperformingContracts,
    "includeUnderperformingContracts",
  )
  const includeOverperformingContracts = validateBoolean(
    record.includeOverperformingContracts,
    "includeOverperformingContracts",
  )
  const notifyChannels = validateChannels(record.notifyChannels)

  return {
    renewalReminderDaysBefore: reminders,
    expirationAlertDays,
    includeUnderperformingContracts,
    includeOverperformingContracts,
    notifyChannels,
  }
}

function validateReminders(value: unknown): number[] {
  if (value === undefined) {
    throw new RenewalAlertSettingsValidationError(
      "renewalReminderDaysBefore",
      "is required",
    )
  }
  if (!Array.isArray(value)) {
    throw new RenewalAlertSettingsValidationError(
      "renewalReminderDaysBefore",
      "must be an array",
    )
  }
  if (value.length === 0) {
    throw new RenewalAlertSettingsValidationError(
      "renewalReminderDaysBefore",
      "must be non-empty",
    )
  }
  if (value.length > MAX_REMINDERS) {
    throw new RenewalAlertSettingsValidationError(
      "renewalReminderDaysBefore",
      `must have at most ${MAX_REMINDERS} entries`,
    )
  }

  const seen = new Set<number>()
  const result: number[] = []
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry <= 0) {
      throw new RenewalAlertSettingsValidationError(
        "renewalReminderDaysBefore",
        "each entry must be a positive integer",
      )
    }
    if (seen.has(entry)) {
      throw new RenewalAlertSettingsValidationError(
        "renewalReminderDaysBefore",
        "duplicate values are not allowed",
      )
    }
    seen.add(entry)
    result.push(entry)
  }

  return result.sort((a, b) => b - a)
}

function validateExpirationAlertDays(value: unknown): number {
  if (value === undefined) {
    throw new RenewalAlertSettingsValidationError(
      "expirationAlertDays",
      "is required",
    )
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RenewalAlertSettingsValidationError(
      "expirationAlertDays",
      "must be a positive integer",
    )
  }
  if (value > MAX_EXPIRATION_ALERT_DAYS) {
    throw new RenewalAlertSettingsValidationError(
      "expirationAlertDays",
      `must be <= ${MAX_EXPIRATION_ALERT_DAYS}`,
    )
  }
  return value
}

function validateBoolean(value: unknown, field: string): boolean {
  if (value === undefined) {
    throw new RenewalAlertSettingsValidationError(field, "is required")
  }
  if (typeof value !== "boolean") {
    throw new RenewalAlertSettingsValidationError(field, "must be a boolean")
  }
  return value
}

function validateChannels(value: unknown): NotifyChannel[] {
  if (value === undefined) {
    throw new RenewalAlertSettingsValidationError(
      "notifyChannels",
      "is required",
    )
  }
  if (!Array.isArray(value)) {
    throw new RenewalAlertSettingsValidationError(
      "notifyChannels",
      "must be an array",
    )
  }
  if (value.length === 0) {
    throw new RenewalAlertSettingsValidationError(
      "notifyChannels",
      "must be non-empty",
    )
  }

  const validSet: ReadonlySet<string> = new Set(VALID_CHANNELS)
  const seen = new Set<NotifyChannel>()
  const result: NotifyChannel[] = []
  for (const entry of value) {
    if (typeof entry !== "string" || !validSet.has(entry)) {
      throw new RenewalAlertSettingsValidationError(
        "notifyChannels",
        `each entry must be one of ${VALID_CHANNELS.join(", ")}`,
      )
    }
    const channel = entry as NotifyChannel
    if (seen.has(channel)) continue
    seen.add(channel)
    result.push(channel)
  }

  return result
}
