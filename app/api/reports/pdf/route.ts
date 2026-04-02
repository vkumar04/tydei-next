import { NextResponse, type NextRequest } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"
import {
  generateContractReport,
  generateRebateReport,
  generateSurgeonScorecard,
} from "@/lib/pdf"

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(`pdf:${session.user.id}`, 10, 60_000)
    if (!success) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 },
      )
    }

    // Resolve user's facility for ownership verification
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id },
      include: { organization: { include: { facility: true } } },
    })
    const userFacilityId = member?.organization?.facility?.id

    const body = await request.json()
    const { type, id, dateRange, facilityId, surgeonName } = body as {
      type: "contract" | "rebate" | "surgeon"
      id?: string
      facilityId?: string
      surgeonName?: string
      dateRange?: { from: string; to: string }
    }

    let pdfBytes: Uint8Array
    let filename: string

    switch (type) {
      case "contract": {
        if (!id) {
          return NextResponse.json(
            { error: "Contract ID is required" },
            { status: 400 }
          )
        }
        // Verify contract belongs to user's facility
        if (userFacilityId) {
          const contract = await prisma.contract.findFirst({
            where: { id, facilityId: userFacilityId },
            select: { id: true },
          })
          if (!contract) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
          }
        }
        pdfBytes = await generateContractReport(id)
        filename = `contract-report-${id}.pdf`
        break
      }
      case "rebate": {
        if (!facilityId) {
          return NextResponse.json(
            { error: "Facility ID is required" },
            { status: 400 }
          )
        }
        if (userFacilityId && facilityId !== userFacilityId) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
        const range = dateRange ?? getDefaultDateRange()
        pdfBytes = await generateRebateReport(facilityId, range)
        filename = `rebate-report-${facilityId}.pdf`
        break
      }
      case "surgeon": {
        if (!facilityId) {
          return NextResponse.json(
            { error: "Facility ID is required" },
            { status: 400 }
          )
        }
        if (userFacilityId && facilityId !== userFacilityId) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
        pdfBytes = await generateSurgeonScorecard(facilityId, surgeonName)
        filename = surgeonName
          ? `surgeon-scorecard-${surgeonName.replace(/\s+/g, "-").toLowerCase()}.pdf`
          : `surgeon-performance-report.pdf`
        break
      }
      default:
        return NextResponse.json(
          { error: `Invalid report type: ${type as string}` },
          { status: 400 }
        )
    }

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBytes.byteLength),
      },
    })
  } catch (error) {
    console.error("[PDF] Generation error:", error)
    return NextResponse.json(
      { error: "Failed to generate PDF report" },
      { status: 500 }
    )
  }
}

function getDefaultDateRange() {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), q * 3, 1)
  const to = new Date(now.getFullYear(), q * 3 + 3, 0)
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  }
}
