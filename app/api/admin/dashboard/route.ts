import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import {
  getAdminDashboardStats,
  getAdminRecentActivity,
  getAdminPendingActions,
} from "@/lib/actions/admin/dashboard"

/**
 * Read endpoint for the admin dashboard's three panels.
 *
 * Same reason as app/api/notifications/route.ts (2026-07-26): Server Actions
 * are dispatched ONE AT A TIME per client, and a queued one keeps POSTing to
 * the route that queued it after the user navigates away. Its response
 * carries that route's RSC payload, which the client commits as a seeded
 * navigation — the operator gets yanked back to /admin/dashboard seconds
 * after clicking through to /admin/users.
 *
 * Moving the two shell polls (#165) cut that from ~1 in 3 to ~1 in 12 but did
 * not end it. These three are the rest of what is in flight when you leave
 * this page: stats, recent activity and pending actions. Together with the
 * notification bell they account for the four distinct action ids seen
 * POSTing to /admin/dashboard in the captured trace.
 *
 * Served as ONE endpoint rather than three because the page renders all
 * three panels together — three parallel Server Actions were being forced
 * through the sequential dispatcher anyway, which the Next docs call out
 * directly ("do not rely on Promise.all to parallelize Server Actions from
 * the client... use a Route Handler for non-mutation requests"). Here they
 * genuinely run in parallel.
 *
 * AUTH: Route Handlers are public HTTP endpoints. This checks the session
 * and the admin role itself and returns 401/403 JSON, rather than leaning on
 * requireAdmin()'s redirect — fetch() follows a redirect and hands back HTML,
 * so the caller would see a parse error instead of an auth failure. The
 * underlying actions each still call requireAdmin(), so the gate is enforced
 * twice and this layer can only ever be more restrictive.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (user?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const [stats, activity, pending] = await Promise.all([
    getAdminDashboardStats(),
    getAdminRecentActivity(10),
    getAdminPendingActions(),
  ])

  return Response.json(
    { stats, activity, pending },
    { headers: { "Cache-Control": "no-store" } },
  )
}
