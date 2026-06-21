/**
 * Client-side export of the facility "Current State" CFO analysis. The
 * dashboard recalculates live from the sliders, so the export must capture the
 * CURRENT client model — these run in the browser off the live `DashboardModel`,
 * not a server snapshot. PDF (shareable exec artifact) + CSV (pull into Excel).
 */

import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import { formatCurrency } from "@/lib/formatting"
import type { FacilityModelAssumptions } from "@/lib/financial-analysis/prospective-impact-model"
import type { DashboardModel } from "./model"
import { usdCompact, pctFromFraction } from "./format"

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const pct1 = (n: number) => `${n.toFixed(1)}%`

// ─── CSV ────────────────────────────────────────────────────────

export function downloadAnalysisCsv(model: DashboardModel): void {
  const { current, impact } = model.prospective

  const summary = toCSV({
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value" },
    ],
    rows: [
      { metric: "Current Vendor Spend", value: current.vendorSpend },
      { metric: "Net Revenue", value: current.netRevenue },
      { metric: "EBITDA", value: current.ebitda },
      { metric: "DCF", value: current.dcf },
      { metric: "Negotiated Annual Savings", value: impact.annualSupplySavings },
      { metric: "Impact to EBITDA", value: impact.impactToEbitda },
      { metric: "Impact to Margin (pts)", value: impact.impactToMarginPoints },
      { metric: "Impact to Distributable Cash Flow", value: impact.impactToDistributableCashFlow },
      { metric: "$ Impact per Case", value: impact.impactPerCase },
    ],
  })

  const categories = toCSV({
    columns: [
      { key: "category", label: "Category" },
      { key: "spend", label: "Spend" },
      { key: "asp", label: "ASP" },
      { key: "share", label: "Share", format: (v) => pct1((v as number) * 100) },
    ],
    rows: model.categoryAsp as unknown as Record<string, unknown>[],
  })

  const vendors = toCSV({
    columns: [
      { key: "vendor", label: "Vendor" },
      { key: "spend", label: "Spend" },
      { key: "share", label: "Share", format: (v) => pct1((v as number) * 100) },
    ],
    rows: model.vendorShare as unknown as Record<string, unknown>[],
  })

  const contribution = toCSV({
    columns: [
      { key: "procedure", label: "Procedure" },
      { key: "cases", label: "Cases" },
      { key: "supplyPerCase", label: "Supply / Case" },
      { key: "contributionMargin", label: "Contribution Margin" },
      { key: "marginPct", label: "Margin %", format: (v) => pct1((v as number) * 100) },
    ],
    rows: model.contributionMargin as unknown as Record<string, unknown>[],
  })

  const ev = toCSV({
    columns: [
      { key: "scenario", label: "EV Scenario" },
      { key: "multiple", label: "Multiple" },
      { key: "currentEv", label: "Current EV" },
      { key: "futureEv", label: "Future EV" },
      { key: "incrementalEv", label: "Incremental EV" },
    ],
    rows: impact.enterpriseValue as unknown as Record<string, unknown>[],
  })

  const csv = [
    "Current State Analysis",
    summary,
    "",
    "Category Spend & ASP",
    categories,
    "",
    "Vendor Market Share",
    vendors,
    "",
    "Contribution Margin by Procedure",
    contribution,
    "",
    "Enterprise Value Impact",
    ev,
  ].join("\n")

  triggerDownload(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    buildReportFilename("Current State Analysis"),
  )
}

// ─── PDF ────────────────────────────────────────────────────────

export async function downloadAnalysisPdf(
  model: DashboardModel,
  assumptions: FacilityModelAssumptions,
  sourceLabel: string,
): Promise<void> {
  const { jsPDF } = await import("jspdf")
  const autoTable = (await import("jspdf-autotable")).default

  const doc = new jsPDF({ unit: "pt", format: "letter" })
  const { current, impact } = model.prospective
  const margin = 40
  let y = margin

  doc.setFontSize(18)
  doc.text("Current State Analysis", margin, y)
  y += 18
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(
    `Administrator / CFO view · ${sourceLabel} · ${new Date().toLocaleDateString("en-US")}`,
    margin,
    y,
  )
  doc.setTextColor(0)
  y += 20

  // KPI summary
  autoTable(doc, {
    startY: y,
    head: [["Current Vendor Spend", "Net Revenue", "EBITDA", "DCF"]],
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
  y = afterTable(doc, y)

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
    y = afterTable(doc, y)
  }

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
      ["DCF projection years", String(assumptions.dcfProjectionYears)],
    ],
  )

  section(
    "Category Spend & ASP",
    [["Category", "Spend", "ASP", "Share"]],
    model.categoryAsp.map((c) => [
      c.category,
      usdCompact(c.spend),
      formatCurrency(c.asp),
      pctFromFraction(c.share),
    ]),
  )

  section(
    "Vendor Market Share",
    [["Vendor", "Spend", "Share"]],
    model.vendorShare.map((v) => [v.vendor, usdCompact(v.spend), pctFromFraction(v.share)]),
  )

  section(
    "Prospective Impact Engine",
    [["Metric", "Value"]],
    [
      ["Negotiated annual savings", usdCompact(impact.annualSupplySavings)],
      ["Impact to EBITDA", usdCompact(impact.impactToEbitda)],
      ["Impact to margin", `+${impact.impactToMarginPoints.toFixed(2)} pts`],
      ["Impact to distributable cash flow", usdCompact(impact.impactToDistributableCashFlow)],
      ["$ impact per case", formatCurrency(impact.impactPerCase)],
    ],
  )

  section(
    "Enterprise Value Impact",
    [["Scenario", "Multiple", "Current EV", "Future EV", "Incremental EV"]],
    impact.enterpriseValue.map((ev) => [
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
      ["Contract Opportunity Score", `${model.opportunityScore.overall} / 100 (top ${model.opportunityScore.topPercentile}%)`],
      ["Future EBITDA (waterfall)", usdCompact(model.waterfall.futureEbitda)],
      ["Incremental EV", usdCompact(model.waterfall.ev.incrementalEv)],
      ["Managed care reimbursement", `${model.managedCare.lowPct}%–${model.managedCare.highPct}% of Medicare`],
      [
        "Payback (Conservative / Expected / Aggressive)",
        model.payback.scenarios
          .map((s) => (s.paybackYears != null ? `${s.paybackYears} yrs` : "—"))
          .join(" / "),
      ],
    ],
  )

  doc.save(buildReportFilename("Current State Analysis").replace(/\.csv$/, ".pdf"))
}

interface AutoTableDoc {
  lastAutoTable?: { finalY: number }
}
function afterTable(doc: unknown, fallback: number): number {
  return (doc as AutoTableDoc).lastAutoTable?.finalY ?? fallback + 20
}
