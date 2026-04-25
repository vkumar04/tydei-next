"use server"

/**
 * In-app notifications (Charles 2026-04-25 audit follow-up).
 *
 * Persistent notification rows displayed in a top-bar bell.
 * Complements the email path in `lib/actions/notifications.ts` so
 * users who don't check email still see pending-contract decisions
 * and other actionable events.
 *
 * Read state: `readAt` (null = unread). markRead bumps it to now;
 * markAllRead does the same for every unread row owned by the
 * current user. Listing is descending by createdAt with a sane cap.
 */
import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  payload: unknown
  actionUrl: string | null
  readAt: string | null
  createdAt: string
}

/**
 * Polymorphic create — used by both facility-side and vendor-side
 * triggers. Writes one row per recipient. Best-effort: failures
 * log + return 0; never throw into the caller.
 *
 * Charles audit round-7 BLOCKER: requires authenticated session.
 * Pre-fix this had NO auth gate — exported "use server" function
 * callable directly via the Next.js action endpoint, so any
 * unauthenticated caller could spam-write Notification rows to
 * arbitrary userIds. The function is intended as an internal helper
 * called by other server actions (which already require auth), so
 * adding a session check is correct semantically.
 */
export async function createInAppNotifications(input: {
  userIds: string[]
  type: string
  title: string
  body?: string | null
  payload?: unknown
  actionUrl?: string | null
}): Promise<{ created: number }> {
  const { requireAuth } = await import("@/lib/actions/auth")
  await requireAuth()
  try {
    if (input.userIds.length === 0) return { created: 0 }
    const result = await prisma.notification.createMany({
      data: input.userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        payload:
          input.payload === undefined
            ? undefined
            : (input.payload as never),
        actionUrl: input.actionUrl ?? null,
      })),
    })
    return { created: result.count }
  } catch (err) {
    console.warn("[createInAppNotifications] failed", err)
    return { created: 0 }
  }
}

/**
 * Bell-list endpoint. Returns the most recent N notifications +
 * unread count. Caller must be authenticated as facility OR vendor.
 */
export async function getMyNotifications(): Promise<{
  rows: NotificationRow[]
  unreadCount: number
}> {
  const userId = await currentUserIdOrThrow()
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ])
  return serialize({
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      payload: r.payload,
      actionUrl: r.actionUrl,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
    unreadCount,
  })
}

export async function markNotificationRead(id: string): Promise<void> {
  const userId = await currentUserIdOrThrow()
  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  })
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const userId = await currentUserIdOrThrow()
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  })
  return { updated: result.count }
}

/**
 * Either role works — bell appears in both portals. The two
 * `requireX()` helpers throw on cross-role mismatch so we wrap the
 * vendor attempt in a try/catch and fall back to facility.
 */
async function currentUserIdOrThrow(): Promise<string> {
  try {
    const { user } = await requireFacility()
    return user.id
  } catch {
    const { user } = await requireVendor()
    return user.id
  }
}
