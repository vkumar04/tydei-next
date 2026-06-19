"use server"

/**
 * Vendor renewals — alert-settings server actions.
 *
 * Vendor-side parity with `lib/actions/renewals/alert-settings.ts`. The
 * `RenewalAlertSettings` Prisma model is keyed per-`userId`, so it is
 * side-agnostic at the data layer — no schema change is needed. The only
 * differences from the facility action are the auth gates:
 *
 *   - reads gate with `requireVendor()` (instead of `requireFacility()`),
 *   - saves additionally gate with `requireCanMutate()` so read-only Users
 *     (the `user` access tier) cannot persist settings.
 *
 * The pure validator (`lib/renewals/alert-settings.ts`) is reused verbatim —
 * it is NOT forked here.
 *
 * `get` returns a materialized default row when the user has never persisted
 * settings (same eager-create rationale as the facility action).
 *
 * Channel routing (`notifyChannels`) is still WRITE-ONLY across both sides —
 * see the facility action's note (audit M14).
 */

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
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

export async function getVendorRenewalAlertSettings(): Promise<RenewalAlertSettings> {
  const { user } = await requireVendor()

  const existing = await prisma.renewalAlertSettings.findUnique({
    where: { userId: user.id },
  })
  if (existing) {
    return serialize(existing) as unknown as RenewalAlertSettings
  }

  // Defaults mirror the Prisma schema defaults (and the facility action).
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

export async function saveVendorRenewalAlertSettings(
  input: RenewalAlertSettingsInput,
): Promise<RenewalAlertSettings> {
  const { user } = await requireVendor()

  // Read-only (`user` access tier) callers throw here before any write runs.
  await requireCanMutate()

  // Throws `RenewalAlertSettingsValidationError` on bad shape. The action
  // intentionally lets it propagate so server-action error boundaries can
  // surface the field/reason to the UI.
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
