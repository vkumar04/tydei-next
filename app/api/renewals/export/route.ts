import { NextResponse, type NextRequest } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import {
  getExpiringContracts,
  type ExpiringContract,
} from "@/lib/actions/renewals"
import {
  generateRenewalsICS,
  type RenewalEvent,
} from "@/lib/renewals/ics-export"

/**
 * GET /api/renewals/export
 *
 * Streams an RFC 5545 `.ics` file of the caller's upcoming renewals.
 * Facility users get every contract owned by their facility; vendor
 * users get every contract owned by their vendor. Window defaults to
 * 365 days and may be overridden with `?windowDays=N`.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id },
      include: {
        organization: {
          include: { facility: true, vendor: true },
        },
      },
    })

    const facilityId = member?.organization?.facility?.id ?? null
    const vendorId = member?.organization?.vendor?.id ?? null

    if (!facilityId && !vendorId) {
      return NextResponse.json(
        { error: "No facility or vendor associated with this account" },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const windowParam = url.searchParams.get("windowDays")
    const parsedWindow = windowParam ? Number.parseInt(windowParam, 10) : NaN
    const windowDays = Number.isFinite(parsedWindow) && parsedWindow > 0 ? parsedWindow : 365

    const contracts: ExpiringContract[] = await getExpiringContracts({
      ...(facilityId ? { facilityId } : { vendorId: vendorId as string }),
      windowDays,
    })

    const events: RenewalEvent[] = contracts.map((c) => ({
      contractId: c.id,
      contractName: c.name,
      vendorName: c.vendorName,
      expirationDate: c.expirationDate,
      daysRemaining: c.daysUntilExpiry,
    }))

    const ics = generateRenewalsICS(events)

    const today = new Date().toISOString().slice(0, 10)
    const filename = `renewals-${today}.ics`

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[renewals/export] error:", error)
    return NextResponse.json(
      { error: "Failed to generate calendar export" },
      { status: 500 },
    )
  }
}
