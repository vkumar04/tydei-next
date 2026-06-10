import { prisma } from "@/lib/db"
import type { NotificationPreferences } from "@/lib/validators/settings"

/**
 * 2026-06-09 settings audit: notification-preference reads used to live
 * inside the "use server" RPC `getNotificationPreferences(entityId)`,
 * which let ANY authenticated user read (and, via the sibling update
 * action, overwrite) any facility's or vendor's org metadata by guessing
 * ids. The RPC is now session-scoped; this plain module keeps the
 * by-entity read available to SERVER-INTERNAL callers only (the email
 * pipeline in lib/actions/notifications.ts derives `entityId` from an
 * owned row, never from the wire). Mirrors the
 * `lib/notifications/in-app-helper.ts` pattern from Iter3-B2.
 */

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  expiringContracts: true,
  tierThresholds: true,
  rebateDue: true,
  paymentDue: true,
  offContract: true,
  pricingErrors: true,
  compliance: true,
  emailEnabled: true,
  inAppEnabled: true,
}

/** Parse the `notificationPrefs` key out of Organization.metadata JSON. */
export function parseNotificationPrefs(
  metadata: string | null | undefined,
): NotificationPreferences {
  if (!metadata) return DEFAULT_NOTIFICATION_PREFS
  try {
    const parsed = JSON.parse(String(metadata))
    return { ...DEFAULT_NOTIFICATION_PREFS, ...parsed.notificationPrefs }
  } catch {
    return DEFAULT_NOTIFICATION_PREFS
  }
}

/**
 * Read an entity's (facility or vendor) notification preferences by id.
 * NOT an RPC surface — only call this with an `entityId` that came from
 * an owned/verified row (e.g. `alert.facilityId`), never from client
 * input.
 */
export async function readNotificationPrefsForEntity(
  entityId: string,
): Promise<NotificationPreferences> {
  const facility = await prisma.facility.findUnique({
    where: { id: entityId },
    select: { organization: { select: { metadata: true } } },
  })

  const vendor = !facility
    ? await prisma.vendor.findUnique({
        where: { id: entityId },
        select: { organization: { select: { metadata: true } } },
      })
    : null

  const metadata =
    facility?.organization?.metadata ?? vendor?.organization?.metadata
  return parseNotificationPrefs(metadata ? String(metadata) : null)
}
