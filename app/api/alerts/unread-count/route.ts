import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import { getOpenAlertCount } from "@/lib/actions/alerts"

/**
 * Open-alert count for <AlertBell>. See app/api/notifications/route.ts for
 * why the 30s poll moved off a Server Action — same reason: actions are
 * dispatched one at a time per client and a queued one keeps posting to the
 * route that queued it after the user has navigated away.
 *
 * TENANT SCOPE: `portalType` is derived from the signed-in user's role, NOT
 * from a query parameter. This is a public HTTP endpoint, so a client-supplied
 * portalType would be an invitation to ask for the other portal's count.
 * `getOpenAlertCount` then derives facilityId/vendorId from the session too
 * (its facilityId/vendorId inputs are deprecated and ignored), so the caller
 * cannot widen the scope at either layer.
 *
 * Admins get 0: the bell is scoped to a single facility or vendor, and the
 * client already disables the query for them (`role !== "admin"`).
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

  if (user?.role !== "facility" && user?.role !== "vendor") {
    return Response.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } })
  }

  const count = await getOpenAlertCount({ portalType: user.role })
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } })
}
