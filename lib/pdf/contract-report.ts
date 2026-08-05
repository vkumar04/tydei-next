import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { prisma } from "@/lib/db"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { deriveContractCadence } from "@/lib/contracts/contract-cadence"
import { formatTierRebateLabel } from "@/lib/contracts/tier-rebate-label"
import {
  addFooter,
  addHeader,
  fmtCurrency,
  fmtDate,
  getFinalY,
  toBytes,
} from "./shared"

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
