import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { prisma } from "@/lib/db"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

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

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

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
    ["Performance Period", contract.performancePeriod],
    ["Rebate Pay Period", contract.rebatePayPeriod],
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
        t.rebateType === "percent_of_spend"
          ? `${(Number(t.rebateValue) * 100).toFixed(2)}%`
          : fmtCurrency(Number(t.rebateValue)),
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
