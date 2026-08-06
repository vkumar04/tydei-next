import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { prisma } from "@/lib/db"
import { addFooter, addHeader, fmtCurrency, fmtDate, getFinalY } from "./shared"

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

  // Aggregated over the FULL matching set, not a page of it.
  //
  // This was `findMany({ take: 500 })` and every figure below was reduced over
  // those rows — so a facility past 500 cases downloaded a "Performance Summary"
  // reading "Total Cases: 500" with Average Case Cost and Margin % computed on a
  // capped denominator. Production is already past it: 674 cases, all on one
  // facility, so an unfiltered surgeon scorecard has been understating spend,
  // reimbursement and margin by every case older than the 500th. A PDF is the
  // worst place for a silent cap — the file outlives any on-screen caveat.
  //
  // Neither the summary nor the per-surgeon table needs the raw rows: both are
  // pure aggregates, so one `aggregate` and one `groupBy` replace the read.
  // `_sum` returns null when nothing matches, hence the ?? 0 coalescing
  // (verified against prisma.io/docs 2026-07-28).
  const [caseTotals, perSurgeon] = await Promise.all([
    prisma.case.aggregate({
      where: caseWhere,
      _count: { _all: true },
      _sum: { totalSpend: true, totalReimbursement: true, margin: true },
    }),
    prisma.case.groupBy({
      by: ["surgeonName"],
      where: caseWhere,
      _count: { _all: true },
      _sum: { totalSpend: true, totalReimbursement: true, margin: true },
    }),
  ])

  // Get surgeon usage data
  const usageWhere: Record<string, unknown> = { facilityId }
  if (surgeonName) usageWhere.surgeonName = surgeonName

  const usages = await prisma.surgeonUsage.findMany({
    where: usageWhere,
    include: { contract: { select: { name: true } } },
    orderBy: { periodStart: "desc" },
  })

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

  const totalCases = caseTotals._count._all
  const totalSpend = Number(caseTotals._sum.totalSpend ?? 0)
  const totalReimbursement = Number(caseTotals._sum.totalReimbursement ?? 0)
  const totalMargin = Number(caseTotals._sum.margin ?? 0)
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
      ["Surgeons", String(perSurgeon.length)],
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
  const surgeonRows = perSurgeon
    .map((g) => {
      const spend = Number(g._sum.totalSpend ?? 0)
      const reimbursement = Number(g._sum.totalReimbursement ?? 0)
      const margin = Number(g._sum.margin ?? 0)
      return {
        name: g.surgeonName ?? "Unknown",
        count: g._count._all,
        spend,
        reimbursement,
        margin,
        mPct:
          reimbursement > 0
            ? ((margin / reimbursement) * 100).toFixed(1) + "%"
            : "N/A",
      }
    })
    .sort((a, b) => b.spend - a.spend)
    .map((r) => [
      r.name,
      String(r.count),
      fmtCurrency(r.spend),
      fmtCurrency(r.reimbursement),
      fmtCurrency(r.margin),
      r.mPct,
    ])

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
