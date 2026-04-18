"use server"

/**
 * Renewals — alert-settings server actions.
 *
 * Reference: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §4.2
 *
 * Wraps the pure validator in `lib/renewals/alert-settings.ts` around a
 * per-user upsert, one row per `userId` (the `@unique` constraint on the
 * Prisma model enforces that invariant).
 *
 * `get` returns a materialized default row when the user has never
 * persisted settings. We create the row eagerly rather than returning a
 * transient default so subsequent reads are cheap and the audit trail
 * for "user first configured alerts" is captured via the create path in
 * the future (we don't audit on the initial default-creation because it
 * isn't a user-initiated action — the UI implicitly reads settings on
 * mount).
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import {
  validateRenewalAlertSettings,
  type RenewalAlertSettingsInput,
} from "@/lib/renewals/alert-settings"

// ─── Row shape returned to callers ───────────────────────────────

export interface RenewalAlertSettings {
  id: string
  userId: string
  renewalReminderDaysBefore: number[]
  expirationAlertDays: number
  includeUnderperformingContracts: boolean
  includeOverperformingContracts: boolean
  notifyChannels: string[]
  createdAt: string
  updatedAt: string
}

// ─── Get (or create defaults) ────────────────────────────────────

export async function getRenewalAlertSettings(): Promise<RenewalAlertSettings> {
  const { user } = await requireFacility()

  const existing = await prisma.renewalAlertSettings.findUnique({
    where: { userId: user.id },
  })
  if (existing) {
    return serialize(existing) as unknown as RenewalAlertSettings
  }

  // Defaults mirror the Prisma schema defaults. Hard-coding here
  // (rather than reading schema defaults at runtime) keeps the action
  // deterministic and testable without a live DB for the defaults.
  const created = await prisma.renewalAlertSettings.create({
    data: {
      userId: user.id,
      renewalReminderDaysBefore: [180, 90, 30],
      expirationAlertDays: 60,
      includeUnderperformingContracts: true,
      includeOverperformingContracts: false,
      notifyChannels: ["email"],
    },
  })

  return serialize(created) as unknown as RenewalAlertSettings
}

// ─── Save (validated upsert) ─────────────────────────────────────

export async function saveRenewalAlertSettings(
  input: RenewalAlertSettingsInput,
): Promise<RenewalAlertSettings> {
  const { user } = await requireFacility()

  // Throws `RenewalAlertSettingsValidationError` on bad shape. The
  // action intentionally lets it propagate so server-action error
  // boundaries can surface the field/reason to the UI.
  const validated = validateRenewalAlertSettings(input)

  const row = await prisma.renewalAlertSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      renewalReminderDaysBefore: validated.renewalReminderDaysBefore,
      expirationAlertDays: validated.expirationAlertDays,
      includeUnderperformingContracts: validated.includeUnderperformingContracts,
      includeOverperformingContracts: validated.includeOverperformingContracts,
      notifyChannels: validated.notifyChannels,
    },
    update: {
      renewalReminderDaysBefore: validated.renewalReminderDaysBefore,
      expirationAlertDays: validated.expirationAlertDays,
      includeUnderperformingContracts: validated.includeUnderperformingContracts,
      includeOverperformingContracts: validated.includeOverperformingContracts,
      notifyChannels: validated.notifyChannels,
    },
  })

  await logAudit({
    userId: user.id,
    action: "renewal.alert_settings_saved",
    entityType: "renewal_alert_settings",
    entityId: row.id,
    metadata: {
      reminderCount: validated.renewalReminderDaysBefore.length,
      expirationAlertDays: validated.expirationAlertDays,
      notifyChannels: validated.notifyChannels,
    },
  })

  return serialize(row) as unknown as RenewalAlertSettings
}
