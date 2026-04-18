"use server"

/**
 * Alerts — header badge count.
 *
 * Per docs/superpowers/specs/2026-04-18-alerts-rewrite.md §4.5.
 * Small, hot-path server action called by every page that renders the
 * global nav. Returns just the new-alerts count for the facility;
 * TanStack Query on the client polls this for live badge updates.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"

export async function getAlertsBadgeCount(): Promise<{
  newCount: number
  totalUnresolved: number
}> {
  const { facility } = await requireFacility()

  const [newCount, totalUnresolved] = await Promise.all([
    prisma.alert.count({
      where: {
        facilityId: facility.id,
        status: "new_alert",
        portalType: "facility",
      },
    }),
    prisma.alert.count({
      where: {
        facilityId: facility.id,
        status: { in: ["new_alert", "read"] },
        portalType: "facility",
      },
    }),
  ])

  return { newCount, totalUnresolved }
}
