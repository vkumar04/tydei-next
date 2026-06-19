import { NextResponse, type NextRequest } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"
import {
  generateContractReport,
  generateRebateReport,
  generateSurgeonScorecard,
  generateReportPerformancePDF,
  type ReportPerfType,
} from "@/lib/pdf"
import { getReportData } from "@/lib/actions/reports"
import { getVendorReportData } from "@/lib/actions/vendor-reports/report-data"

const REPORT_PERF_TYPES: ReportPerfType[] = [
  "usage",
  "service",
  "capital",
  "tie_in",
  "grouped",
]

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

    // Resolve user's facility for ownership verification. This route
    // serves facility-scoped PHI/financial PDFs, so a caller WITHOUT a
    // facility membership (vendor users, admins, facility-less accounts)
    // must be rejected outright — never fall through to an unguarded
    // generate. (Mirrors better-auth's own org pattern: no membership →
    // reject. Previously `if (userFacilityId)` made the ownership check
    // optional, leaking any tenant's report to any authenticated user.)
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id },
      include: { organization: { include: { facility: true, vendor: true } } },
    })
    const userFacility = member?.organization?.facility ?? null
    const userVendor = member?.organization?.vendor ?? null
    const userFacilityId = userFacility?.id

    const body = await request.json()
    const {
      type,
      id,
      dateRange,
      facilityId,
      surgeonName,
      scope,
      reportType,
      contractId,
    } = body as {
      type: "contract" | "rebate" | "surgeon" | "report"
      id?: string
      facilityId?: string
      surgeonName?: string
      dateRange?: { from: string; to: string }
      scope?: "facility" | "vendor"
      reportType?: ReportPerfType
      contractId?: string
    }

    let pdfBytes: Uint8Array
    let filename: string

    // ── Contract Performance Details (Reports Hub, both portals) ──
    // Vendor-scoped exports must NOT require a facility membership; the
    // server action (requireVendor / requireFacility) enforces ownership.
    if (type === "report") {
      if (!reportType || !REPORT_PERF_TYPES.includes(reportType)) {
        return NextResponse.json(
          { error: "Invalid or missing reportType" },
          { status: 400 },
        )
      }
      if (!dateRange?.from || !dateRange?.to) {
        return NextResponse.json(
          { error: "dateRange is required" },
          { status: 400 },
        )
      }
      const isVendor = scope === "vendor"
      if (isVendor && !userVendor) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      if (!isVendor && !userFacilityId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const data = isVendor
        ? await getVendorReportData({
            reportType,
            dateFrom: dateRange.from,
            dateTo: dateRange.to,
          })
        : await getReportData({
            reportType,
            dateFrom: dateRange.from,
            dateTo: dateRange.to,
          })

      const allContracts = (data.contracts ??
        []) as unknown as Parameters<
        typeof generateReportPerformancePDF
      >[0]["contracts"]
      const contracts = contractId
        ? allContracts.filter((c) => c.id === contractId)
        : allContracts

      pdfBytes = generateReportPerformancePDF({
        entityName: isVendor
          ? (userVendor?.name ?? "Vendor")
          : (userFacility?.name ?? "Facility"),
        reportType,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        contracts,
      })
      filename = `contract-performance-${reportType}.pdf`

      return new Response(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(pdfBytes.byteLength),
        },
      })
    }

    // Facility-only report types below — require a facility membership.
    if (!userFacilityId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    switch (type) {
      case "contract": {
        if (!id) {
          return NextResponse.json(
            { error: "Contract ID is required" },
            { status: 400 }
          )
        }
        // Verify contract belongs to user's facility.
        const contract = await prisma.contract.findFirst({
          where: { id, facilityId: userFacilityId },
          select: { id: true },
        })
        if (!contract) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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
        if (facilityId !== userFacilityId) {
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
        if (facilityId !== userFacilityId) {
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
