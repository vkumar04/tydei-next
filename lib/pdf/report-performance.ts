import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { computeRunningCapitalBalances } from "@/lib/reports/running-capital-balance"
import {
  addFooter,
  addHeader,
  fmtCurrency,
  fmtDate,
  getFinalY,
  toBytes,
} from "./shared"

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
