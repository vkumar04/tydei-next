import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { prisma } from "@/lib/db"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { addFooter, addHeader, fmtCurrency, fmtDate, getFinalY } from "./shared"

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
