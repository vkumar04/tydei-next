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
import { requireAuth } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

/**
 * Rows the bell dropdown fetches.
 *
 * Deliberately NOT exported: this is a `"use server"` file, where every export
 * must be an async function (a bare `export const` gets wrapped in
 * `registerServerReference` and kills every action in the module at load).
 * The value ships to the client inside `getMyNotifications`'s payload instead,
 * so the UI never hard-codes a second copy that could drift from this one.
 *
 * 50 rather than 20 because the dropdown now scrolls: at the observed
 * production shape (max 26 notifications for any one user) this covers every
 * user completely, and when it does not, the footer says so.
 */
const NOTIFICATION_BELL_LIMIT = 50

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
 * Polymorphic create — Charles audit Iter3-B2 (CRITICAL, confirmed
 * exploit): the previous `createInAppNotifications` "use server"
 * export accepted arbitrary `userIds` + `title` + `actionUrl` from
 * the wire and was used by Stryker user to plant a phishing
 * notification ("Account locked — click to verify" → http://evil.com)
 * into a foreign facility user's inbox.
 *
 * Per CLAUDE.md "use server hygiene": internal helpers MUST live in
 * non-"use server" modules so they cannot be RPC-invoked. The helper
 * has been moved to `lib/notifications/in-app-helper.ts` as
 * `createInAppNotificationsInternal`. Internal server-action callers
 * (notifyFacilityOfPendingContract, notifyVendorOfPendingDecision,
 * notifyVendorOfProposalDecision) import it directly from their own
 * already-authenticated context. There is intentionally no
 * "use server" passthrough — adding one would re-open the leak.
 */

/**
 * Bell-list endpoint. Returns the most recent N notifications +
 * unread count. Caller must be authenticated as facility OR vendor.
 */
export async function getMyNotifications(): Promise<{
  rows: NotificationRow[]
  unreadCount: number
  total: number
  limit: number
}> {
  const userId = await currentUserIdOrThrow()
  const [rows, unreadCount, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: NOTIFICATION_BELL_LIMIT,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    // Uncapped, so the bell can SAY how much it is not showing. Previously
    // the list was capped at 20 while `unreadCount` was uncapped, and nothing
    // reconciled the two: a user with 25 unread saw a badge reading 25 above
    // a list of 20, with no pager, no "view all", and no total — so five
    // notifications, including actionable ones, were unreachable from
    // anywhere in the app (Charles 2026-07-28 revalidation).
    prisma.notification.count({ where: { userId } }),
  ])
  return serialize({
    total,
    limit: NOTIFICATION_BELL_LIMIT,
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

// Marking your OWN notification read is a personal read-state action (like
// self-profile), NOT a tenant business mutation — so it is deliberately NOT
// gated by requireCanMutate(): a read-only `user`-tier member must still be
// able to clear their own bell (Vick 2026-06-21 "these don't clear when
// read"). Scoping stays on `userId` so no one can touch another user's rows.
export async function markNotificationRead(id: string): Promise<void> {
  // read-only-guard-skip: personal read-state on the caller's OWN notification
  // (scoped by userId), not a tenant business mutation — read-only `user` tier
  // must still be able to clear its bell (like self-profile, which is untiered).
  const userId = await currentUserIdOrThrow()
  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  })
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  // read-only-guard-skip: personal read-state on the caller's OWN notifications
  // (scoped by userId) — see markNotificationRead.
  const userId = await currentUserIdOrThrow()
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  })
  return { updated: result.count }
}

/**
 * The signed-in user's id. Notifications are scoped by `userId` alone —
 * `where: { userId }` in every query here — so no facility/vendor lookup is
 * needed, and requiring one was actively harmful.
 *
 * What this replaced, and why it mattered:
 *
 *     try { return (await requireFacility()).user.id }
 *     catch { return (await requireVendor()).user.id }
 *
 * `requireRole` signals a role mismatch with `redirect()`, and `redirect()`
 * works by THROWING a NEXT_REDIRECT control-flow exception. So for an admin:
 * requireFacility() threw a redirect, the `catch` SWALLOWED it, requireVendor()
 * threw another, and that one escaped — turning every call into a 303 to
 * `roleConfig["admin"].defaultRedirect`, i.e. /admin/dashboard.
 *
 * <NotificationBell> renders in every portal shell with no `enabled` guard, so
 * this fired on every admin page load. On /admin/dashboard it redirected to
 * itself and was invisible; on /admin/users it bounced the operator straight
 * back to the dashboard — the reported "clicking Users goes back to the
 * dashboard" (2026-07-26).
 *
 * Never wrap a `requireX()` guard in try/catch: catching NEXT_REDIRECT
 * converts an intended navigation into whatever the fallback path does.
 */
async function currentUserIdOrThrow(): Promise<string> {
  const session = await requireAuth()
  return session.user.id
}
