import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { formatCompactCurrency } from "@/lib/formatting"
import { fmtCurrency, getFinalY, toBytes } from "./shared"

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
