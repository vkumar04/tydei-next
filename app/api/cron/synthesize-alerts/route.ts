/**
 * Cron sweep: synthesize + persist alerts for EVERY facility (2026-06-09
 * renewals+alerts audit H4b).
 *
 * Without a scheduled runner, alerts only refresh when a facility user
 * imports COG data or clicks the manual refresh — time-driven conditions
 * (expiring_contract, rebate_due, vendor_inactive) never fire on quiet
 * tenants. Point any scheduler (Railway cron, GitHub Action, curl) at:
 *
 *   GET /api/cron/synthesize-alerts
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Returns 404 when CRON_SECRET is unset so the route is invisible in
 * environments that haven't opted in; 401 on a bad/missing token.
 */
import { timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/db"
import { runAlertSynthesisForFacility } from "@/lib/alerts/synthesize-persist"

export const dynamic = "force-dynamic"

/** Constant-time bearer-token check — avoids a timing side-channel on CRON_SECRET. */
function authorized(request: Request, secret: string): boolean {
  const provided = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${secret}`)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return new Response("Not found", { status: 404 })
  }
  if (!authorized(request, secret)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const facilities = await prisma.facility.findMany({
    select: { id: true, name: true },
  })

  let created = 0
  let resolved = 0
  const failures: Array<{ facilityId: string; reason: string }> = []

  // Sequential on purpose — the synthesizer loads a facility's full COG
  // set; fanning out in parallel would spike the DB for zero urgency.
  for (const f of facilities) {
    try {
      const result = await runAlertSynthesisForFacility(f.id)
      created += result.created
      resolved += result.resolved
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error("[cron/synthesize-alerts] facility failed", err, {
        facilityId: f.id,
        facilityName: f.name,
      })
      failures.push({ facilityId: f.id, reason })
    }
  }

  return Response.json({
    facilities: facilities.length,
    created,
    resolved,
    failures,
  })
}
