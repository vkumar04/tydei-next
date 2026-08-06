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
  generateTableReportPDF,
  generateAnalysisReportPDF,
  generateOpportunityReportPDF,
  type ReportPerfType,
  type AnalysisReportPayload,
  type OpportunityReportPayload,
} from "@/lib/pdf"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { getReportData } from "@/lib/actions/reports"
import { getVendorReportData } from "@/lib/actions/vendor-reports/report-data"
import {
  getVendorRebateStatement,
  getVendorPerformanceSummary,
  getVendorContractRoster,
} from "@/lib/actions/vendor-reports"
import {
  formatExportDate,
  formatExportDollars,
  formatExportPercent,
} from "@/lib/reports/export-formatters"

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
      vendorReport,
      payload,
    } = body as {
      type:
        | "contract"
        | "rebate"
        | "surgeon"
        | "report"
        | "vendor-report"
        | "analysis"
        | "opportunity"
      id?: string
      facilityId?: string
      surgeonName?: string
      dateRange?: { from: string; to: string }
      scope?: "facility" | "vendor"
      reportType?: ReportPerfType
      contractId?: string
      vendorReport?: "rebates" | "performance" | "roster"
      /** Live client-model snapshot for type analysis/opportunity. */
      payload?: unknown
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
            // Vendor-scoped: narrow to the selected facility when present.
            // The action only NARROWS the vendor's own contracts, so a
            // bad facilityId can't reach another tenant's data.
            facilityId,
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

    // ── Vendor Reports cards (Rebate Statement / Performance / Roster) ──
    // Vendor-scoped; the actions enforce ownership via requireVendor, so this
    // must NOT require a facility membership. Renders via the shared
    // server-side generator (generateTableReportPDF) — same data the CSV
    // cards fetch, now as a real PDF (Vick 2026-06-22).
    if (type === "vendor-report") {
      if (!userVendor) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      const from = dateRange?.from
      const to = dateRange?.to
      const periodLabel = from && to ? `  ·  ${from} to ${to}` : ""

      let title: string
      let head: string[]
      let rows: string[][]
      let numericColumns: number[]
      let intro: string
      const sum = <T,>(arr: T[], pick: (t: T) => number) =>
        arr.reduce((s, t) => s + pick(t), 0)
      const plural = (n: number, one: string, many: string) =>
        `${n} ${n === 1 ? one : many}`

      if (vendorReport === "rebates") {
        if (!from || !to) {
          return NextResponse.json({ error: "dateRange is required" }, { status: 400 })
        }
        const data = await getVendorRebateStatement(from, to)
        title = "Vendor Rebate Statement"
        head = ["Contract", "Facility", "Earned This Period", "Collected This Period", "Outstanding"]
        rows = data.map((r) => [
          r.contractName,
          r.facilityName,
          formatExportDollars(r.earnedThisPeriod),
          formatExportDollars(r.collectedThisPeriod),
          formatExportDollars(r.outstanding),
        ])
        numericColumns = [2, 3, 4]
        intro =
          `Across ${plural(data.length, "contract", "contracts")}, ${userVendor.name} earned ` +
          `${formatExportDollars(sum(data, (r) => r.earnedThisPeriod))} and collected ` +
          `${formatExportDollars(sum(data, (r) => r.collectedThisPeriod))} in rebates for ${from} → ${to}, ` +
          `with ${formatExportDollars(sum(data, (r) => r.outstanding))} still outstanding.`
      } else if (vendorReport === "performance") {
        if (!from || !to) {
          return NextResponse.json({ error: "dateRange is required" }, { status: 400 })
        }
        const data = await getVendorPerformanceSummary(from, to)
        title = "Vendor Performance Summary"
        head = ["Facility", "Spend", "Rebate Earned", "Rebate Collected", "Compliance %", "Market Share %"]
        rows = data.map((r) => [
          r.facilityName,
          formatExportDollars(r.spend),
          formatExportDollars(r.earned),
          formatExportDollars(r.collected),
          formatExportPercent(r.compliancePercent),
          formatExportPercent(r.marketSharePercent),
        ])
        numericColumns = [1, 2, 3, 4, 5]
        const avgComp = data.length ? sum(data, (r) => r.compliancePercent) / data.length : 0
        const avgShare = data.length ? sum(data, (r) => r.marketSharePercent) / data.length : 0
        intro =
          `Across ${plural(data.length, "facility", "facilities")}, ${userVendor.name} drove ` +
          `${formatExportDollars(sum(data, (r) => r.spend))} of spend with ` +
          `${formatExportDollars(sum(data, (r) => r.earned))} earned / ` +
          `${formatExportDollars(sum(data, (r) => r.collected))} collected — averaging ` +
          `${formatExportPercent(avgComp)} compliance and ${formatExportPercent(avgShare)} market share for ${from} → ${to}.`
      } else if (vendorReport === "roster") {
        const data = await getVendorContractRoster()
        title = "Vendor Contract Roster"
        head = [
          "Contract", "Contract #", "Facility", "Status", "Effective",
          "Expiration", "Rebate Method", "Last Activity", "Earned YTD", "Earned Lifetime",
        ]
        rows = data.map((r) => [
          r.contractName,
          r.contractNumber ?? "",
          r.facilityName,
          r.status,
          formatExportDate(new Date(r.effectiveDate)),
          formatExportDate(new Date(r.expirationDate)),
          r.rebateMethod,
          r.lastActivity ? formatExportDate(new Date(r.lastActivity)) : "",
          formatExportDollars(r.rebateEarnedYTD),
          formatExportDollars(r.rebateEarnedLifetime),
        ])
        numericColumns = [8, 9]
        const active = data.filter((r) => r.status === "active").length
        intro =
          `${userVendor.name} holds ${plural(data.length, "contract", "contracts")} ` +
          `(${active} active) — ${formatExportDollars(sum(data, (r) => r.rebateEarnedYTD))} earned YTD, ` +
          `${formatExportDollars(sum(data, (r) => r.rebateEarnedLifetime))} lifetime.`
      } else {
        return NextResponse.json({ error: "Invalid vendorReport" }, { status: 400 })
      }

      const pdfBytes = generateTableReportPDF({
        title,
        subtitle: `${userVendor.name}${periodLabel}`,
        intro,
        head,
        rows,
        numericColumns,
      })
      return new Response(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${title.replace(/\s+/g, "-").toLowerCase()}.pdf"`,
          "Content-Length": String(pdfBytes.byteLength),
        },
      })
    }

    // ── Vendor Opportunity Engine export (Deal Scenario) ──
    // Vendor-scoped: the page recalculates client-side and POSTs its live
    // scenario snapshot; nothing tenant-owned is read server-side, so the
    // only gate is a vendor membership (no facility membership needed).
    if (type === "opportunity") {
      if (!userVendor) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      const p = payload as OpportunityReportPayload | undefined
      if (!p?.scenario || !p.engine || !p.score) {
        return NextResponse.json(
          { error: "Invalid or missing payload" },
          { status: 400 },
        )
      }
      // A malformed NESTED payload (missing arrays the generator dereferences)
      // is a client bug, not a server error — return 400, not the outer 500
      // (security audit 2026-07-05, M2). The payload is the caller's own
      // client model, so nothing tenant-owned leaks either way.
      let pdfBytes: Uint8Array
      try {
        pdfBytes = generateOpportunityReportPDF(p)
      } catch (err) {
        console.error("[reports/pdf] opportunity payload malformed:", err)
        return NextResponse.json(
          { error: "Invalid payload shape" },
          { status: 400 },
        )
      }
      return new Response(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            'attachment; filename="opportunity-engine-scenario.pdf"',
          "Content-Length": String(pdfBytes.byteLength),
        },
      })
    }

    // ── Facility Analysis dashboard export (Current State Analysis) ──
    // Facility-scoped: hard-fail when the caller has NO facility membership
    // (never gate ownership behind `if (userFacilityId)`). The payload is the
    // caller's own live slider model, so membership is the ownership check.
    if (type === "analysis") {
      if (!userFacilityId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      const p = payload as AnalysisReportPayload | undefined
      if (!p?.current || !p.impact || !p.assumptions) {
        return NextResponse.json(
          { error: "Invalid or missing payload" },
          { status: 400 },
        )
      }
      let pdfBytes: Uint8Array
      try {
        pdfBytes = generateAnalysisReportPDF(p)
      } catch (err) {
        console.error("[reports/pdf] analysis payload malformed:", err)
        return NextResponse.json(
          { error: "Invalid payload shape" },
          { status: 400 },
        )
      }
      return new Response(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            'attachment; filename="current-state-analysis.pdf"',
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
        // Verify contract belongs to user's facility — via the canonical
        // ownership predicate, so multi-facility (join-table) contracts
        // export for their rightful owners too (a bare facilityId check
        // 403'd them).
        const contract = await prisma.contract.findFirst({
          where: contractOwnershipWhere(id, userFacilityId),
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
