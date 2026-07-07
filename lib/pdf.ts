import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { prisma } from "@/lib/db"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { deriveContractCadence } from "@/lib/contracts/contract-cadence"
import { formatTierRebateLabel } from "@/lib/contracts/tier-rebate-label"
import {
  formatCurrency,
  formatCompactCurrency,
  formatPercent,
} from "@/lib/formatting"
import { computeRunningCapitalBalances } from "@/lib/reports/running-capital-balance"

// ─── jspdf-autotable extends the doc with lastAutoTable ──────────

interface AutoTableDoc extends jsPDF {
  lastAutoTable?: { finalY: number }
}

function getFinalY(doc: jsPDF, fallback: number): number {
  return (doc as AutoTableDoc).lastAutoTable?.finalY ?? fallback
}

function toBytes(doc: jsPDF): Uint8Array {
  const buf = doc.output("arraybuffer")
  return new Uint8Array(buf)
}

// ─── Helpers ──────────────────────────────────────────────────────

const fmtCurrency = formatCurrency

function fmtDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date))
}

function addHeader(doc: jsPDF, title: string, subtitle?: string) {
  // Brand header bar
  doc.setFillColor(15, 23, 42) // slate-900
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(255, 255, 255)
  doc.text("TYDEi", 14, 14)

  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(200, 200, 200)
  doc.text(`Generated ${fmtDate(new Date())}`, doc.internal.pageSize.getWidth() - 14, 14, {
    align: "right",
  })

  // Title
  doc.setTextColor(15, 23, 42)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.text(title, 14, 40)

  if (subtitle) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text(subtitle, 14, 48)
  }
}

function addFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: "center" }
    )
    doc.text(
      "Confidential - TYDEi Platform",
      14,
      doc.internal.pageSize.getHeight() - 10
    )
  }
}

// ─── Contract Report ──────────────────────────────────────────────

export async function generateContractReport(contractId: string): Promise<Uint8Array> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      vendor: { select: { name: true } },
      facility: { select: { name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
      },
      periods: {
        orderBy: { periodStart: "asc" },
      },
      // Charles 2026-04-23 audit — PDF totals must match the app's
      // canonical rebate figures. Pull the Rebate rows so the summary
      // row can route through sumEarnedRebatesLifetime /
      // sumCollectedRebates instead of summing ContractPeriod fields.
      rebates: {
        select: {
          payPeriodEnd: true,
          rebateEarned: true,
          collectionDate: true,
          rebateCollected: true,
        },
      },
    },
  })

  const doc = new jsPDF()
  addHeader(
    doc,
    `Contract Report: ${contract.name}`,
    `${contract.vendor.name} — ${contract.facility?.name ?? "Multi-Facility"}`
  )

  // ── Contract Summary ──
  let y = 56
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text("Contract Summary", 14, y)
  y += 6

  const summaryData = [
    ["Contract Number", contract.contractNumber ?? "N/A"],
    ["Type", contract.contractType],
    ["Status", contract.status],
    ["Effective Date", fmtDate(contract.effectiveDate)],
    ["Expiration Date", fmtDate(contract.expirationDate)],
    ["Total Value", fmtCurrency(Number(contract.totalValue))],
    ["Annual Value", fmtCurrency(Number(contract.annualValue))],
    ["Auto Renewal", contract.autoRenewal ? "Yes" : "No"],
    ["Termination Notice", `${contract.terminationNoticeDays} days`],
    // 2026-06-09: derive from terms (canonical helper) so the PDF matches
    // the contract-detail panels instead of the stale stored defaults.
    [
      "Performance Period",
      deriveContractCadence(contract.terms, contract).performancePeriod,
    ],
    [
      "Rebate Pay Period",
      deriveContractCadence(contract.terms, contract).rebatePayPeriod,
    ],
  ]

  autoTable(doc, {
    startY: y,
    body: summaryData,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 50, textColor: [100, 100, 100] },
      1: { cellWidth: 120 },
    },
    margin: { left: 14 },
  })

  // ── Terms & Tiers ──
  for (const term of contract.terms) {
    y = getFinalY(doc, y)
    y += 10

    if (y > 250) {
      doc.addPage()
      y = 20
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(`Term: ${term.termName}`, 14, y)
    y += 4

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(
      `${term.termType} | ${term.baselineType} | ${fmtDate(term.effectiveStart)} - ${fmtDate(term.effectiveEnd)}`,
      14,
      y + 2
    )
    y += 8

    if (term.tiers.length > 0) {
      const tierHeaders = [["Tier", "Spend Min", "Spend Max", "Rebate Type", "Rebate Value"]]
      const tierRows = term.tiers.map((t) => [
        String(t.tierNumber),
        fmtCurrency(Number(t.spendMin)),
        t.spendMax ? fmtCurrency(Number(t.spendMax)) : "No Cap",
        t.rebateType,
        formatTierRebateLabel(t.rebateType, Number(t.rebateValue)),
      ])

      autoTable(doc, {
        startY: y,
        head: tierHeaders,
        body: tierRows,
        theme: "striped",
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
        margin: { left: 14 },
      })
    }
  }

  // ── Spend History ──
  if (contract.periods.length > 0) {
    y = getFinalY(doc, y)
    y += 10

    if (y > 220) {
      doc.addPage()
      y = 20
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.setTextColor(15, 23, 42)
    doc.text("Spend History", 14, y)
    y += 6

    const periodHeaders = [["Period", "Total Spend", "Volume", "Rebate Earned", "Rebate Collected", "Tier"]]
    const periodRows = contract.periods.map((p) => [
      `${fmtDate(p.periodStart)} - ${fmtDate(p.periodEnd)}`,
      fmtCurrency(Number(p.totalSpend)),
      p.totalVolume.toLocaleString(),
      fmtCurrency(Number(p.rebateEarned)),
      fmtCurrency(Number(p.rebateCollected)),
      p.tierAchieved ? String(p.tierAchieved) : "-",
    ])

    // Totals row — canonical Rebate-table figures (Charles 2026-04-23).
    // The per-period rows above still come from ContractPeriod so the
    // monthly audit trail renders; the summary row uses the canonical
    // helpers so PDFs agree with Contract Detail and the Dashboard.
    const totalSpend = contract.periods.reduce((s, p) => s + Number(p.totalSpend), 0)
    const totalVolume = contract.periods.reduce((s, p) => s + p.totalVolume, 0)
    const totalRebateEarned = sumEarnedRebatesLifetime(contract.rebates)
    const totalRebateCollected = sumCollectedRebates(contract.rebates)

    periodRows.push([
      "TOTAL",
      fmtCurrency(totalSpend),
      totalVolume.toLocaleString(),
      fmtCurrency(totalRebateEarned),
      fmtCurrency(totalRebateCollected),
      "",
    ])

    autoTable(doc, {
      startY: y,
      head: periodHeaders,
      body: periodRows,
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      margin: { left: 14 },
      didParseCell: (data) => {
        // Bold the totals row
        if (data.row.index === periodRows.length - 1 && data.section === "body") {
          data.cell.styles.fontStyle = "bold"
          data.cell.styles.fillColor = [240, 240, 240]
        }
      },
    })
  }

  addFooter(doc)
  return toBytes(doc)
}

// ─── Contract Performance Details (Reports Hub: facility + vendor) ──
//
// Server-side, table-only render of the "Contract Performance Details"
// report the Reports Hub shows on screen (header band + per-period table),
// for the active per-type tab and optional drill-down to one contract.
// Mirrors ReportContractHeader + ReportPeriodTable. Charts are NOT
// embedded (recharts is client-only) — this is the table fidelity export.

export type ReportPerfType = "usage" | "service" | "capital" | "tie_in" | "grouped"

interface ReportPerfPeriod {
  periodStart: string
  periodEnd: string
  totalSpend: number
  totalVolume: number
  rebateEarned: number
  rebateCollected: number
  paymentExpected: number
  paymentActual: number
  tierAchieved: number | null
}

interface ReportPerfContract {
  id: string
  name: string
  contractNumber: string | null
  vendor: string
  contractType: string
  effectiveDate: string
  expirationDate: string
  totalValue: number
  rebateEarnedCanonical: number
  rebateCollectedCanonical: number
  marginCanonical: number
  /** Tie-in / capital remaining capital balance — drives the Balance column. */
  capitalRemainingBalance?: number | null
  periods: ReportPerfPeriod[]
}

export interface ReportPerformanceInput {
  entityName: string
  reportType: ReportPerfType
  dateFrom: string
  dateTo: string
  contracts: ReportPerfContract[]
}

const REPORT_TYPE_LABEL: Record<ReportPerfType, string> = {
  usage: "Usage Contract Performance",
  service: "Service Contract Performance",
  capital: "Capital Contract Performance",
  tie_in: "Tie-In Contract Performance",
  grouped: "Grouped Contract Performance",
}

// Per-type period columns, mirroring ReportPeriodTable. Each entry is
// [header, value-fn]. The period label column is prepended by the caller.
function periodColumnsFor(
  type: ReportPerfType,
): { header: string; value: (p: ReportPerfPeriod) => string; align?: "right" }[] {
  const money = (n: number) => fmtCurrency(n)
  switch (type) {
    case "service":
    case "capital":
      return [
        { header: "Payment Expected", value: (p) => money(p.paymentExpected), align: "right" },
        { header: "Payment Actual", value: (p) => money(p.paymentActual), align: "right" },
        {
          header: "Variance",
          value: (p) => money(p.paymentActual - p.paymentExpected),
          align: "right",
        },
      ]
    case "tie_in":
      return [
        { header: "Spend", value: (p) => money(p.totalSpend), align: "right" },
        { header: "Volume", value: (p) => p.totalVolume.toLocaleString(), align: "right" },
        { header: "Rebate Earned", value: (p) => money(p.rebateEarned), align: "right" },
        { header: "Rebate Collected", value: (p) => money(p.rebateCollected), align: "right" },
        { header: "Payment Actual", value: (p) => money(p.paymentActual), align: "right" },
      ]
    case "grouped":
      return [
        { header: "Spend", value: (p) => money(p.totalSpend), align: "right" },
        { header: "Rebate Earned", value: (p) => money(p.rebateEarned), align: "right" },
      ]
    case "usage":
    default:
      return [
        { header: "Spend", value: (p) => money(p.totalSpend), align: "right" },
        { header: "Volume", value: (p) => p.totalVolume.toLocaleString(), align: "right" },
        { header: "Rebate Earned", value: (p) => money(p.rebateEarned), align: "right" },
        { header: "Rebate Collected", value: (p) => money(p.rebateCollected), align: "right" },
      ]
  }
}

export function generateReportPerformancePDF(
  input: ReportPerformanceInput,
): Uint8Array {
  const { entityName, reportType, dateFrom, dateTo, contracts } = input
  // Landscape — the per-period tables run up to ~8 columns (tie-in: Spend,
  // Volume, Rebate Earned, Rebate Collected, Payment Actual, Balance + Period),
  // which overflow/clip in portrait (Vick 2026-06-22 "exported report doesn't
  // have all the data, it's not landscape").
  const doc = new jsPDF({ orientation: "landscape" })
  addHeader(
    doc,
    "Contract Performance Details",
    `${entityName} — ${REPORT_TYPE_LABEL[reportType]}  ·  ${fmtDate(dateFrom)} to ${fmtDate(dateTo)}`,
  )

  let y = 56

  if (contracts.length === 0) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    doc.setTextColor(120, 120, 120)
    doc.text("No contracts in this category for the selected range.", 14, y)
    addFooter(doc)
    return toBytes(doc)
  }

  const cols = periodColumnsFor(reportType)

  contracts.forEach((c, idx) => {
    if (idx > 0) {
      doc.addPage()
      y = 20
    } else if (y > 230) {
      doc.addPage()
      y = 20
    }

    // Contract header band (mirrors ReportContractHeader metadata).
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.setTextColor(15, 23, 42)
    doc.text(c.name, 14, y)
    y += 6

    autoTable(doc, {
      startY: y,
      body: [
        ["Contract ID", c.contractNumber ?? c.name],
        ["Vendor", c.vendor],
        ["Type", c.contractType],
        ["Effective", fmtDate(c.effectiveDate)],
        ["Expiration", fmtDate(c.expirationDate)],
        ["Contract Total", fmtCurrency(c.totalValue)],
        ["Contract Margin", fmtCurrency(c.marginCanonical)],
      ],
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 1.5 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 45, textColor: [100, 100, 100] },
        1: { cellWidth: 120 },
      },
      margin: { left: 14 },
    })

    y = getFinalY(doc, y) + 8

    // Balance column for capital-like contracts — running remaining capital
    // balance, anchored to the contract's current balance (mirrors the
    // on-screen ReportPeriodTable so the PDF carries the same data).
    const isCapitalLike =
      c.contractType === "tie_in" || c.contractType === "capital"
    const balances =
      isCapitalLike && c.capitalRemainingBalance != null
        ? computeRunningCapitalBalances(c.periods, c.capitalRemainingBalance)
        : null

    // Per-period table.
    const head = [
      ["Period", ...cols.map((col) => col.header), ...(balances ? ["Balance"] : [])],
    ]
    const body = c.periods.map((p, i) => [
      `${fmtDate(p.periodStart)} - ${fmtDate(p.periodEnd)}`,
      ...cols.map((col) => col.value(p)),
      ...(balances ? [fmtCurrency(balances[i])] : []),
    ])

    // Totals row — canonical rebate figures where applicable.
    const totalsByHeader: Record<string, string> = {
      Spend: fmtCurrency(c.periods.reduce((s, p) => s + p.totalSpend, 0)),
      Volume: c.periods.reduce((s, p) => s + p.totalVolume, 0).toLocaleString(),
      "Rebate Earned": fmtCurrency(c.rebateEarnedCanonical),
      "Rebate Collected": fmtCurrency(c.rebateCollectedCanonical),
      "Payment Expected": fmtCurrency(
        c.periods.reduce((s, p) => s + p.paymentExpected, 0),
      ),
      "Payment Actual": fmtCurrency(
        c.periods.reduce((s, p) => s + p.paymentActual, 0),
      ),
      Variance: fmtCurrency(
        c.periods.reduce((s, p) => s + (p.paymentActual - p.paymentExpected), 0),
      ),
    }
    body.push([
      "TOTAL",
      ...cols.map((col) => totalsByHeader[col.header] ?? ""),
      ...(balances
        ? [
            c.capitalRemainingBalance != null
              ? fmtCurrency(c.capitalRemainingBalance)
              : "",
          ]
        : []),
    ])

    autoTable(doc, {
      startY: y,
      head,
      body,
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      columnStyles: cols.reduce<Record<number, { halign: "right" }>>(
        (acc, col, i) => {
          if (col.align === "right") acc[i + 1] = { halign: "right" }
          // Right-align the appended Balance column when present.
          if (balances) acc[cols.length + 1] = { halign: "right" }
          return acc
        },
        {},
      ),
      margin: { left: 14 },
      didParseCell: (data) => {
        if (data.row.index === body.length - 1 && data.section === "body") {
          data.cell.styles.fontStyle = "bold"
          data.cell.styles.fillColor = [240, 240, 240]
        }
      },
    })

    y = getFinalY(doc, y)
  })

  addFooter(doc)
  return toBytes(doc)
}

// ─── Generic tabular report ───────────────────────────────────────

export interface TableReportInput {
  title: string
  subtitle?: string
  /**
   * Plain-English explainer rendered above the table — tells the story of the
   * numbers (totals, counts) instead of leaving the reader to add up columns.
   */
  intro?: string
  /** Column headers, left → right. */
  head: string[]
  /** Pre-formatted string cells (caller applies $/%/date formatting). */
  rows: string[][]
  /** Indices of columns to right-align (numeric/currency). */
  numericColumns?: number[]
}

/**
 * One generic table → PDF, reusing the branded header/footer. Backs the vendor
 * Reports cards (Rebate Statement / Performance Summary / Contract Roster) so
 * they emit a real PDF server-side instead of only a CSV (Vick 2026-06-22).
 * Empty result sets render an explicit "No data for this period." row so the
 * PDF is never blank. Wide tables (>6 cols, e.g. the roster) go landscape.
 */
export function generateTableReportPDF(input: TableReportInput): Uint8Array {
  const doc = new jsPDF(
    input.head.length > 6 ? { orientation: "landscape" } : {},
  )
  addHeader(doc, input.title, input.subtitle)

  // Narrative explainer above the table — tells the story before the numbers.
  let startY = 56
  if (input.intro) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    const lines = doc.splitTextToSize(
      input.intro,
      doc.internal.pageSize.getWidth() - 28,
    ) as string[]
    doc.text(lines, 14, startY)
    startY += lines.length * 4.6 + 6
    doc.setTextColor(0, 0, 0)
  }

  const columnStyles: Record<number, { halign: "right" }> = {}
  for (const i of input.numericColumns ?? []) columnStyles[i] = { halign: "right" }

  autoTable(doc, {
    startY,
    head: [input.head],
    body:
      input.rows.length > 0
        ? input.rows
        : [["No data for this period.", ...input.head.slice(1).map(() => "")]],
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    columnStyles,
  })

  addFooter(doc)
  return toBytes(doc)
}

// ─── Rebate Report ────────────────────────────────────────────────

export async function generateRebateReport(
  facilityId: string,
  dateRange: { from: string; to: string }
): Promise<Uint8Array> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true },
  })

  const rebates = await prisma.rebate.findMany({
    where: {
      facilityId,
      payPeriodStart: { gte: new Date(dateRange.from) },
      payPeriodEnd: { lte: new Date(dateRange.to) },
    },
    include: {
      contract: {
        select: { name: true, vendor: { select: { name: true } } },
      },
    },
    orderBy: { payPeriodStart: "asc" },
  })

  const doc = new jsPDF()
  addHeader(
    doc,
    `Rebate Summary: ${facility.name}`,
    `${fmtDate(dateRange.from)} - ${fmtDate(dateRange.to)}`
  )

  // ── Summary Stats ──
  // Canonical helpers (Charles 2026-04-23 audit). Earned sums only
  // rows whose payPeriodEnd <= today; collected sums only rows with a
  // non-null collectionDate. Matches Contract Detail / Dashboard /
  // Contracts List semantics exactly.
  let y = 56
  const totalEarned = sumEarnedRebatesLifetime(rebates)
  const totalCollected = sumCollectedRebates(rebates)
  const totalUnearned = rebates.reduce((s, r) => s + Number(r.rebateUnearned), 0)
  const outstanding = totalEarned - totalCollected

  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text("Overview", 14, y)
  y += 6

  autoTable(doc, {
    startY: y,
    body: [
      ["Total Rebate Earned", fmtCurrency(totalEarned)],
      ["Total Rebate Collected", fmtCurrency(totalCollected)],
      ["Outstanding (Earned - Collected)", fmtCurrency(outstanding)],
      ["Unearned Rebate", fmtCurrency(totalUnearned)],
      ["Number of Rebate Records", String(rebates.length)],
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 60, textColor: [100, 100, 100] },
      1: { cellWidth: 60 },
    },
    margin: { left: 14 },
  })

  // ── Rebate Details ──
  y = getFinalY(doc, y)
  y += 10

  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text("Rebate Details", 14, y)
  y += 6

  if (rebates.length > 0) {
    const headers = [["Contract", "Vendor", "Period", "Earned", "Collected", "Collection Date"]]
    const rows = rebates.map((r) => [
      r.contract.name,
      r.contract.vendor.name,
      `${fmtDate(r.payPeriodStart)} - ${fmtDate(r.payPeriodEnd)}`,
      fmtCurrency(Number(r.rebateEarned)),
      fmtCurrency(Number(r.rebateCollected)),
      r.collectionDate ? fmtDate(r.collectionDate) : "Pending",
    ])

    autoTable(doc, {
      startY: y,
      head: headers,
      body: rows,
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      margin: { left: 14 },
    })
  } else {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(150, 150, 150)
    doc.text("No rebate records found for this period.", 14, y)
  }

  addFooter(doc)
  return new Uint8Array(doc.output("arraybuffer"))
}

// ─── Surgeon Scorecard ────────────────────────────────────────────

export async function generateSurgeonScorecard(
  facilityId: string,
  surgeonName?: string
): Promise<Uint8Array> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true },
  })

  // Get surgeon cases
  const caseWhere: Record<string, unknown> = { facilityId }
  if (surgeonName) caseWhere.surgeonName = surgeonName

  const cases = await prisma.case.findMany({
    where: caseWhere,
    orderBy: { dateOfSurgery: "desc" },
    take: 500,
  })

  // Get surgeon usage data
  const usageWhere: Record<string, unknown> = { facilityId }
  if (surgeonName) usageWhere.surgeonName = surgeonName

  const usages = await prisma.surgeonUsage.findMany({
    where: usageWhere,
    include: { contract: { select: { name: true } } },
    orderBy: { periodStart: "desc" },
  })

  // Group cases by surgeon
  const surgeonMap = new Map<
    string,
    { cases: typeof cases; totalSpend: number; totalReimbursement: number; totalMargin: number }
  >()

  for (const c of cases) {
    const name = c.surgeonName ?? "Unknown"
    const existing = surgeonMap.get(name) ?? {
      cases: [],
      totalSpend: 0,
      totalReimbursement: 0,
      totalMargin: 0,
    }
    existing.cases.push(c)
    existing.totalSpend += Number(c.totalSpend)
    existing.totalReimbursement += Number(c.totalReimbursement)
    existing.totalMargin += Number(c.margin)
    surgeonMap.set(name, existing)
  }

  const doc = new jsPDF()
  const title = surgeonName
    ? `Surgeon Scorecard: ${surgeonName}`
    : "Surgeon Performance Report"
  addHeader(doc, title, facility.name)

  let y = 56

  // ── Summary ──
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text("Performance Summary", 14, y)
  y += 6

  const totalCases = cases.length
  const totalSpend = cases.reduce((s, c) => s + Number(c.totalSpend), 0)
  const totalReimbursement = cases.reduce((s, c) => s + Number(c.totalReimbursement), 0)
  const totalMargin = cases.reduce((s, c) => s + Number(c.margin), 0)
  const avgCaseCost = totalCases > 0 ? totalSpend / totalCases : 0
  const marginPct = totalReimbursement > 0 ? (totalMargin / totalReimbursement) * 100 : 0

  autoTable(doc, {
    startY: y,
    body: [
      ["Total Cases", String(totalCases)],
      ["Total Spend", fmtCurrency(totalSpend)],
      ["Total Reimbursement", fmtCurrency(totalReimbursement)],
      ["Total Margin", fmtCurrency(totalMargin)],
      ["Average Case Cost", fmtCurrency(avgCaseCost)],
      ["Margin %", `${marginPct.toFixed(1)}%`],
      ["Surgeons", String(surgeonMap.size)],
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 50, textColor: [100, 100, 100] },
      1: { cellWidth: 60 },
    },
    margin: { left: 14 },
  })

  // ── Per-Surgeon Breakdown ──
  y = getFinalY(doc, y)
  y += 10

  if (y > 240) {
    doc.addPage()
    y = 20
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text("Surgeon Breakdown", 14, y)
  y += 6

  const surgeonHeaders = [["Surgeon", "Cases", "Spend", "Reimbursement", "Margin", "Margin %"]]
  const surgeonRows = Array.from(surgeonMap.entries())
    .sort((a, b) => b[1].totalSpend - a[1].totalSpend)
    .map(([name, data]) => {
      const mPct =
        data.totalReimbursement > 0
          ? ((data.totalMargin / data.totalReimbursement) * 100).toFixed(1) + "%"
          : "N/A"
      return [
        name,
        String(data.cases.length),
        fmtCurrency(data.totalSpend),
        fmtCurrency(data.totalReimbursement),
        fmtCurrency(data.totalMargin),
        mPct,
      ]
    })

  autoTable(doc, {
    startY: y,
    head: surgeonHeaders,
    body: surgeonRows,
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    margin: { left: 14 },
  })

  // ── Compliance / Usage Data ──
  if (usages.length > 0) {
    y = getFinalY(doc, y)
    y += 10

    if (y > 230) {
      doc.addPage()
      y = 20
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.setTextColor(15, 23, 42)
    doc.text("Contract Compliance", 14, y)
    y += 6

    const usageHeaders = [["Surgeon", "Contract", "Period", "Usage Amount", "Cases", "Compliance"]]
    const usageRows = usages.map((u) => [
      u.surgeonName ?? "Unknown",
      u.contract?.name ?? "N/A",
      `${fmtDate(u.periodStart)} - ${fmtDate(u.periodEnd)}`,
      fmtCurrency(Number(u.usageAmount)),
      String(u.caseCount),
      `${Number(u.complianceRate).toFixed(1)}%`,
    ])

    autoTable(doc, {
      startY: y,
      head: usageHeaders,
      body: usageRows,
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
      margin: { left: 14 },
    })
  }

  addFooter(doc)
  return new Uint8Array(doc.output("arraybuffer"))
}

// ─── Facility Analysis dashboard export (Current State Analysis) ──
//
// The dashboard recalculates live from client-side sliders, so the client
// serializes the CURRENT model into this payload and POSTs it to
// /api/reports/pdf (type: "analysis"); the layout renders here server-side
// (Vick 2026-07-02 "make all pdf gen backend only").

export interface AnalysisReportAssumptions {
  netRevenue: number
  currentVendorSpend: number
  annualCaseVolume: number
  /** Fractions (0.28 = 28%). */
  ebitdaMarginPct: number
  dcfPctOfEbitda: number
  discountRatePct: number
  cashFlowGrowthPct: number
  terminalGrowthPct: number
  dcfProjectionYears: number
}

export interface AnalysisReportPayload {
  /** e.g. "Live COG" or "Uploaded file: <name>". */
  sourceLabel: string
  /** Pre-built plain-English narrative (buildNarrative, client-side). */
  narrative: string
  current: {
    vendorSpend: number
    netRevenue: number
    ebitda: number
    dcf: number
    dcfExplicit: number
    dcfTerminalValue: number
  }
  impact: {
    annualSupplySavings: number
    impactToEbitda: number
    impactToMarginPoints: number
    impactToDistributableCashFlow: number
    impactPerCase: number
  }
  assumptions: AnalysisReportAssumptions
  categoryAsp: { category: string; spend: number; asp: number; share: number }[]
  vendorShare: { vendor: string; spend: number; share: number }[]
  contributionMargin: {
    procedure: string
    cases: number
    supplyPerCase: number
    contributionMargin: number
    marginPct: number
  }[]
  categoryImpact: {
    category: string
    cases: number
    annualImpact: number
    impactPerCase: number
    marginPct: number
    newMarginPct: number
  }[]
  enterpriseValue: {
    scenario: string
    multiple: number
    currentEv: number
    futureEv: number
    incrementalEv: number
  }[]
  /** AI Prospective Impact Engine summary row values. */
  ai: {
    opportunityOverall: number
    opportunityTopPercentile: number
    waterfallFutureEbitda: number
    waterfallIncrementalEv: number
    managedCareLowPct: number
    managedCareHighPct: number
    /** Conservative / Expected / Aggressive payback years (null = n/a). */
    paybackYears: (number | null)[]
  }
  conversionTargets: {
    headline: string | null
    targets: {
      category: string
      savingsOpportunity: number
      pctOfTotalBenefit: number
      volumeSharePct: number
      aboveBenchmarkAsp: boolean
    }[]
  }
}

const usdCompact = (n: number) => formatCompactCurrency(n, { kDecimals: 1 })
const pct1 = (n: number) => `${n.toFixed(1)}%`
const pctFromFraction = (fraction: number, decimals = 2) =>
  `${(fraction * 100).toFixed(decimals)}%`

export function generateAnalysisReportPDF(
  payload: AnalysisReportPayload,
): Uint8Array {
  const { current, impact, assumptions } = payload
  const doc = new jsPDF({ unit: "pt", format: "letter" })
  const margin = 40
  let y = margin

  doc.setFontSize(18)
  doc.text("Current State Analysis", margin, y)
  y += 18
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(
    `Administrator / CFO view · ${payload.sourceLabel} · ${new Date().toLocaleDateString("en-US")}`,
    margin,
    y,
  )
  doc.setTextColor(0)
  y += 18

  // Narrative — tell the story before the tables.
  doc.setFontSize(10)
  const narrativeLines = doc.splitTextToSize(payload.narrative, 515) as string[]
  doc.text(narrativeLines, margin, y)
  y += narrativeLines.length * 13 + 8

  const afterTable = (fallback: number) => getFinalY(doc, fallback + 20)

  // KPI summary
  autoTable(doc, {
    startY: y,
    head: [["Current Vendor Spend", "Net Revenue", "EBITDA", "DCF (EV)"]],
    body: [
      [
        usdCompact(current.vendorSpend),
        usdCompact(current.netRevenue),
        usdCompact(current.ebitda),
        usdCompact(current.dcf),
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: [30, 41, 59] },
  })
  y = afterTable(y)

  const section = (title: string, head: string[][], body: string[][]) => {
    doc.setFontSize(12)
    doc.text(title, margin, y + 6)
    autoTable(doc, {
      startY: y + 12,
      head,
      body,
      theme: "striped",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
    })
    y = afterTable(y)
  }

  section(
    "Enterprise Value (DCF) breakdown",
    [["Component", "Value"]],
    [
      ["Explicit window PV", usdCompact(current.dcfExplicit)],
      ["Terminal value PV", usdCompact(current.dcfTerminalValue)],
      ["Enterprise value (total)", usdCompact(current.dcf)],
    ],
  )

  section(
    "Financial Assumptions",
    [["Assumption", "Value"]],
    [
      ["Net revenue", usdCompact(assumptions.netRevenue)],
      ["Current vendor spend", usdCompact(assumptions.currentVendorSpend)],
      ["Annual case volume", assumptions.annualCaseVolume.toLocaleString("en-US")],
      ["EBITDA margin", pct1(assumptions.ebitdaMarginPct * 100)],
      ["Distributable cash flow % of EBITDA", pct1(assumptions.dcfPctOfEbitda * 100)],
      ["Discount rate", pct1(assumptions.discountRatePct * 100)],
      ["Cash flow growth", pct1(assumptions.cashFlowGrowthPct * 100)],
      ["Terminal growth", pct1(assumptions.terminalGrowthPct * 100)],
      ["DCF projection years", String(assumptions.dcfProjectionYears)],
    ],
  )

  section(
    "Category Spend & ASP",
    [["Category", "Spend", "ASP", "Share"]],
    payload.categoryAsp.map((c) => [
      c.category,
      usdCompact(c.spend),
      fmtCurrency(c.asp),
      pctFromFraction(c.share),
    ]),
  )

  section(
    "Vendor Market Share",
    [["Vendor", "Spend", "Share"]],
    payload.vendorShare.map((v) => [
      v.vendor,
      usdCompact(v.spend),
      pctFromFraction(v.share),
    ]),
  )

  section(
    "Contribution Margin by Procedure",
    [["Procedure", "Cases", "Supply / Case", "Contribution Margin", "Margin %"]],
    payload.contributionMargin.map((c) => [
      c.procedure,
      c.cases.toLocaleString("en-US"),
      fmtCurrency(c.supplyPerCase),
      usdCompact(c.contributionMargin),
      pct1(c.marginPct * 100),
    ]),
  )

  section(
    "Individual Impact by Category",
    [["Category", "Cases", "Annual Impact", "Impact / Case", "Margin %", "New Margin %"]],
    payload.categoryImpact.map((c) => [
      c.category,
      c.cases.toLocaleString("en-US"),
      usdCompact(c.annualImpact),
      fmtCurrency(c.impactPerCase),
      pct1(c.marginPct * 100),
      pct1(c.newMarginPct * 100),
    ]),
  )

  section(
    "Prospective Impact Engine",
    [["Metric", "Value"]],
    [
      ["Negotiated annual savings", usdCompact(impact.annualSupplySavings)],
      ["Impact to EBITDA", usdCompact(impact.impactToEbitda)],
      ["Impact to margin", `+${impact.impactToMarginPoints.toFixed(2)} pts`],
      ["Impact to distributable cash flow", usdCompact(impact.impactToDistributableCashFlow)],
      ["$ impact per case", fmtCurrency(impact.impactPerCase)],
    ],
  )

  section(
    "Enterprise Value Impact",
    [["Scenario", "Multiple", "Current EV", "Future EV", "Incremental EV"]],
    payload.enterpriseValue.map((ev) => [
      ev.scenario,
      `${ev.multiple}x`,
      usdCompact(ev.currentEv),
      usdCompact(ev.futureEv),
      usdCompact(ev.incrementalEv),
    ]),
  )

  section(
    "AI Prospective Impact Engine",
    [["Surface", "Result"]],
    [
      [
        "Contract Opportunity Score",
        `${payload.ai.opportunityOverall} / 100 (top ${payload.ai.opportunityTopPercentile}%)`,
      ],
      ["Future EBITDA (waterfall)", usdCompact(payload.ai.waterfallFutureEbitda)],
      ["Incremental EV", usdCompact(payload.ai.waterfallIncrementalEv)],
      [
        "Managed care reimbursement",
        `${payload.ai.managedCareLowPct}%–${payload.ai.managedCareHighPct}% of Medicare`,
      ],
      [
        "Payback (Conservative / Expected / Aggressive)",
        payload.ai.paybackYears
          .map((years) => (years != null ? `${years} yrs` : "—"))
          .join(" / "),
      ],
    ],
  )

  section(
    "Recommended Conversion Targets",
    [["Category", "Savings", "% of Benefit", "Behavior Change", "Above Benchmark ASP"]],
    payload.conversionTargets.targets.map((t) => [
      t.category,
      usdCompact(t.savingsOpportunity),
      pct1(t.pctOfTotalBenefit * 100),
      pct1(t.volumeSharePct * 100),
      t.aboveBenchmarkAsp ? "Yes" : "No",
    ]),
  )
  if (payload.conversionTargets.headline) {
    doc.setFontSize(9)
    doc.setTextColor(120)
    const headlineLines = doc.splitTextToSize(
      payload.conversionTargets.headline,
      515,
    ) as string[]
    doc.text(headlineLines, margin, y + 4)
    doc.setTextColor(0)
    y += headlineLines.length * 11 + 10
  }

  return toBytes(doc)
}

// ─── Vendor Opportunity Engine export (Deal Scenario) ─────────────
//
// Same server-side pattern: the Opportunity Engine page recalculates
// client-side, serializes the live scenario/score/snapshot into this payload,
// and POSTs it (type: "opportunity").

export interface OpportunityReportPayload {
  /**
   * Plain-English story paragraphs (buildOpportunityNarrative, client-side) —
   * rendered as section 1, before the Facility Current State table.
   */
  narrative: string[]
  scenario: {
    division: string
    facility: string
    /** Fractions (0.05 = 5%). */
    priceChangePct: number
    targetShare: number
    expectedVolumeGrowthPct: number
  }
  engine: {
    winProbability: number
    incrementalRevenue: number
    currentRevenue: number
    targetRevenue: number
    netUnitImpact: number
    blendedMarketShare: number
    territoryRecurringRevenue: number
    capitalRoboticRevenue: number
  }
  score: {
    overall: number
    winProbability: {
      probability: number
      riskLevel: string
      recommendedAction: string
    }
    recommendedOffer: { targetConversionPct: number; items: string[] }
  }
  /**
   * Facility Current State — pre-formatted label/value rows built client-side
   * by facilityCurrentStateRows (the ONE builder shared with the CSV export).
   */
  facility: { facilityName: string; rows: [string, string][] } | null
  /** Per-construct deal rows (present when reached via the stepper). */
  constructs: {
    productName: string
    category?: string
    current: number
    floor: number
    target: number
    ask: number
    annualVolume: number
    rebatePercent: number
  }[]
}

export function generateOpportunityReportPDF(
  payload: OpportunityReportPayload,
): Uint8Array {
  const { scenario, engine, score } = payload
  const pct = (n: number) => formatPercent(n * 100)
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

  const doc = new jsPDF({ unit: "pt", format: "letter" })
  const margin = 40
  let y = margin

  doc.setFontSize(18)
  doc.text("Opportunity Engine — Deal Scenario", margin, y)
  y += 18
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(
    `${scenario.division} · ${scenario.facility} · ${new Date().toLocaleDateString("en-US")}`,
    margin,
    y,
  )
  doc.setTextColor(0)
  y += 16

  // Narrative — tell the story before the tables (mirrors the Analysis
  // export). `?? []` guards payloads posted by an older client.
  doc.setFontSize(10)
  for (const paragraph of payload.narrative ?? []) {
    const lines = doc.splitTextToSize(paragraph, 515) as string[]
    doc.text(lines, margin, y)
    y += lines.length * 13 + 6
  }
  y += 2

  const after = (fallback: number) => getFinalY(doc, fallback + 20)

  // Facility Current State — the financial picture of the pitch target.
  if (payload.facility) {
    doc.setFontSize(12)
    doc.text(
      `Facility Current State — ${payload.facility.facilityName}`,
      margin,
      y + 6,
    )
    autoTable(doc, {
      startY: y + 12,
      head: [["Metric", "Value"]],
      body: payload.facility.rows,
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 9 },
    })
    y = after(y)
  }

  autoTable(doc, {
    startY: y,
    head: [["Lever", "Value"]],
    body: [
      ["Division", scenario.division],
      ["Facility", scenario.facility],
      ["Price change vs ASP", pct(scenario.priceChangePct)],
      ["Target market share", pct(scenario.targetShare)],
      ["Expected volume growth", pct(scenario.expectedVolumeGrowthPct)],
    ],
    theme: "striped",
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
  })
  y = after(y)

  autoTable(doc, {
    startY: y + 6,
    head: [["Outcome", "Value"]],
    body: [
      ["Win probability", pct(engine.winProbability)],
      [
        "Incremental revenue",
        `+${formatCompactCurrency(engine.incrementalRevenue)} (${formatCompactCurrency(engine.currentRevenue)} → ${formatCompactCurrency(engine.targetRevenue)})`,
      ],
      ["Net unit impact", `+${Math.round(engine.netUnitImpact)}`],
      ["Blended market share", pct(engine.blendedMarketShare)],
      ["Territory recurring revenue", formatCompactCurrency(engine.territoryRecurringRevenue)],
      ["Capital / robotic revenue", formatCompactCurrency(engine.capitalRoboticRevenue)],
      ["Opportunity score", `${score.overall} / 100`],
      [
        "AI win probability",
        `${pct(score.winProbability.probability)} (risk ${score.winProbability.riskLevel})`,
      ],
      ["Recommended action", score.winProbability.recommendedAction],
    ],
    theme: "striped",
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
  })
  y = after(y)

  // Proposed Deal — by product (the per-construct breakdown of the deal built
  // in step 1; present when the export was reached via the stepper).
  if (payload.constructs.length > 0) {
    doc.setFontSize(12)
    doc.text("Proposed Deal — by product", margin, y + 6)
    autoTable(doc, {
      startY: y + 12,
      head: [["Product", "Category", "Current", "Floor", "Target", "Ask", "Volume", "Rebate %"]],
      body: payload.constructs.map((c) => [
        c.productName,
        c.category || "—",
        usd(c.current),
        usd(c.floor),
        usd(c.target),
        usd(c.ask),
        c.annualVolume.toLocaleString(),
        `${c.rebatePercent}%`,
      ]),
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 8 },
    })
    y = after(y)
  }

  doc.setFontSize(12)
  doc.text(
    `Recommended Offer — ${score.recommendedOffer.targetConversionPct}% conversion`,
    margin,
    y + 6,
  )
  autoTable(doc, {
    startY: y + 12,
    head: [["Offer lever"]],
    body: score.recommendedOffer.items.map((i) => [i]),
    theme: "striped",
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
  })

  return toBytes(doc)
}
