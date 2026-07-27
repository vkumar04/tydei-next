import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { getMyNotifications } from "@/lib/actions/notifications/in-app"

/**
 * Bell-list read endpoint for <NotificationBell>.
 *
 * Why this is a Route Handler and not the Server Action it used to call
 * (2026-07-26): the Next docs are explicit that Server Actions exist "to
 * mutate data" and that "using them for data fetching introduces sequential
 * execution" — actions are dispatched ONE AT A TIME per client. A 30s poll
 * therefore sits in that queue, and a queued action keeps posting to the
 * route that queued it even after the user has navigated away. That is
 * exactly the shape of the /admin/users bounce: actions still POSTing to
 * /admin/dashboard seconds after landing on /admin/users.
 *
 * A Route Handler returns plain JSON. It cannot commit an RSC payload and
 * so cannot navigate the router, whatever else is in flight.
 *
 * The bell's MUTATIONS (markNotificationRead / markAllNotificationsRead)
 * deliberately stay Server Actions — that is what they are for.
 *
 * Route Handlers are public HTTP endpoints, so this authenticates on its
 * own rather than trusting the caller. `getMyNotifications` scopes every
 * query to `userId` derived from the session, so there is nothing here a
 * caller can widen. The session check below is what turns an unauthenticated
 * request into a 401 JSON response instead of `requireAuth`'s redirect to
 * /login, which fetch() would follow and hand back as HTML.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const data = await getMyNotifications()
  return Response.json(data, {
    // Never cache a per-user inbox.
    headers: { "Cache-Control": "no-store" },
  })
}
