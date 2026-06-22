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
const pct0 = (n: number) => `${Math.round(n)}%`

/**
 * Plain-English narrative tying the numbers together — spend → revenue →
 * EBITDA → DCF (explicit + terminal), then the prospective-saving lift. The
 * export "tells the story of the data" instead of dumping bare tables (Vick
 * 2026-06-22).
 */
export function buildNarrative(
  model: DashboardModel,
  assumptions: FacilityModelAssumptions,
): string {
  const { current, impact } = model.prospective
  const supplyPct =
    current.netRevenue > 0 ? (current.vendorSpend / current.netRevenue) * 100 : 0
  const expected = impact.enterpriseValue.find((e) => e.scenario === "expected")
  const terminalGrowth = assumptions.terminalGrowthPct ?? 0.03

  const state =
    `This facility runs ${usdCompact(current.netRevenue)} of net revenue against ` +
    `${usdCompact(current.vendorSpend)} of annual supply spend (${pct0(supplyPct)} of revenue), ` +
    `producing ${usdCompact(current.ebitda)} of EBITDA at a ${pct0(current.ebitdaMarginPct * 100)} margin. ` +
    `Discounting ${assumptions.dcfProjectionYears} years of distributable cash flow ` +
    `(${pct0(assumptions.dcfPctOfEbitda * 100)} of EBITDA) at ${pct0(assumptions.discountRatePct * 100)} ` +
    `with ${pct1(terminalGrowth * 100)} terminal growth yields an enterprise value (DCF) of ` +
    `${usdCompact(current.dcf)} — ${usdCompact(current.dcfExplicit)} from the explicit ` +
    `${assumptions.dcfProjectionYears}-year window plus ${usdCompact(current.dcfTerminalValue)} of terminal value.`

  const lift =
    impact.annualSupplySavings > 0
      ? ` A negotiated ${usdCompact(impact.annualSupplySavings)}/yr supply saving ` +
        `(${pct1(impact.savingsPctOfSpend * 100)} of spend) flows straight to EBITDA, lifting it to ` +
        `${usdCompact(impact.futureEbitda)} (+${impact.impactToMarginPoints.toFixed(2)} margin pts)` +
        (expected
          ? ` and adding ${usdCompact(expected.incrementalEv)} of enterprise value at a ${expected.multiple}x exit.`
          : ".")
      : " Model a negotiated supply saving in the Prospective Impact section to see the EBITDA and enterprise-value lift."

  return state + lift
}

// ─── CSV ────────────────────────────────────────────────────────

export function downloadAnalysisCsv(
  model: DashboardModel,
  assumptions: FacilityModelAssumptions,
): void {
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
      { metric: "DCF (enterprise value)", value: current.dcf },
      { metric: "DCF — explicit window", value: current.dcfExplicit },
      { metric: "DCF — terminal value", value: current.dcfTerminalValue },
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

  const individualImpact = toCSV({
    columns: [
      { key: "category", label: "Category" },
      { key: "cases", label: "Cases" },
      { key: "annualImpact", label: "Annual Impact" },
      { key: "impactPerCase", label: "Impact / Case" },
      { key: "marginPct", label: "Margin %", format: (v) => pct1((v as number) * 100) },
      { key: "newMarginPct", label: "New Margin %", format: (v) => pct1((v as number) * 100) },
    ],
    rows: model.categoryImpact as unknown as Record<string, unknown>[],
  })

  const assumptionsCsv = toCSV({
    columns: [
      { key: "assumption", label: "Assumption" },
      { key: "value", label: "Value" },
    ],
    rows: [
      { assumption: "Annual case volume", value: assumptions.annualCaseVolume },
      { assumption: "EBITDA margin", value: pct1(assumptions.ebitdaMarginPct * 100) },
      { assumption: "Distributable cash flow % of EBITDA", value: pct1(assumptions.dcfPctOfEbitda * 100) },
      { assumption: "Discount rate", value: pct1(assumptions.discountRatePct * 100) },
      { assumption: "Cash flow growth", value: pct1(assumptions.cashFlowGrowthPct * 100) },
      { assumption: "Terminal growth", value: pct1((assumptions.terminalGrowthPct ?? 0.03) * 100) },
      { assumption: "DCF projection years", value: assumptions.dcfProjectionYears },
    ],
  })

  const narrativeCsv = toCSV({
    columns: [{ key: "narrative", label: "Narrative" }],
    rows: [{ narrative: buildNarrative(model, assumptions) }],
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
    narrativeCsv,
    "",
    "Summary",
    summary,
    "",
    "Financial Assumptions",
    assumptionsCsv,
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
    "Individual Impact by Category",
    individualImpact,
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
  y += 18

  // Narrative — tell the story before the tables.
  doc.setFontSize(10)
  const narrativeLines = doc.splitTextToSize(
    buildNarrative(model, assumptions),
    515,
  ) as string[]
  doc.text(narrativeLines, margin, y)
  y += narrativeLines.length * 13 + 8

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
      ["Terminal growth", pct1((assumptions.terminalGrowthPct ?? 0.03) * 100)],
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
    "Contribution Margin by Procedure",
    [["Procedure", "Cases", "Supply / Case", "Contribution Margin", "Margin %"]],
    model.contributionMargin.map((c) => [
      c.procedure,
      c.cases.toLocaleString("en-US"),
      formatCurrency(c.supplyPerCase),
      usdCompact(c.contributionMargin),
      pct1(c.marginPct * 100),
    ]),
  )

  section(
    "Individual Impact by Category",
    [["Category", "Cases", "Annual Impact", "Impact / Case", "Margin %", "New Margin %"]],
    model.categoryImpact.map((c) => [
      c.category,
      c.cases.toLocaleString("en-US"),
      usdCompact(c.annualImpact),
      formatCurrency(c.impactPerCase),
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
