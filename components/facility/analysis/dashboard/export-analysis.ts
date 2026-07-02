/**
 * Export of the facility "Current State" CFO analysis. The dashboard
 * recalculates live from the sliders, so the export captures the CURRENT
 * client model (`DashboardModel`), not a server snapshot. CSV builds in the
 * browser (pull into Excel); the PDF serializes the model into an
 * `AnalysisReportPayload` and POSTs it to /api/reports/pdf, which renders it
 * server-side (all PDF generation is backend-only — Vick 2026-07-02).
 */

import { toast } from "sonner"
import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import { formatCurrency } from "@/lib/formatting"
import type { FacilityModelAssumptions } from "@/lib/financial-analysis/prospective-impact-model"
import type { AnalysisReportPayload } from "@/lib/pdf"
import type { DashboardModel } from "./model"
import { usdCompact } from "./format"

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

/**
 * Pure CSV builder — exported so the "exports carry the full picture" rule is
 * testable without a DOM download.
 */
export function buildAnalysisCsv(
  model: DashboardModel,
  assumptions: FacilityModelAssumptions,
): string {
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

  // ── AI Prospective Impact Engine layer (parity with the PDF + dashboard) ──

  const opportunityScore = toCSV({
    columns: [
      { key: "component", label: "Component" },
      { key: "weight", label: "Weight" },
      { key: "score", label: "Score (0-100)" },
      { key: "weightedContribution", label: "Weighted Points" },
    ],
    rows: [
      ...model.opportunityScore.components.map((c) => ({
        component: c.label,
        weight: c.weight,
        score: c.score,
        weightedContribution: c.weightedContribution,
      })),
      {
        component: `Overall (top ${model.opportunityScore.topPercentile}%)`,
        weight: 100,
        score: model.opportunityScore.overall,
        weightedContribution: model.opportunityScore.overall,
      },
    ],
  })

  const waterfall = toCSV({
    columns: [
      { key: "label", label: "Step" },
      { key: "value", label: "Value" },
      { key: "cumulative", label: "Cumulative EBITDA" },
    ],
    rows: model.waterfall.steps as unknown as Record<string, unknown>[],
  })

  const waterfallEv = toCSV({
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value" },
    ],
    rows: [
      { metric: "EV multiple", value: `${model.waterfall.ev.multiple}x` },
      { metric: "Current EV", value: model.waterfall.ev.currentEv },
      { metric: "Future EV", value: model.waterfall.ev.futureEv },
      { metric: "Incremental EV", value: model.waterfall.ev.incrementalEv },
    ],
  })

  const conversionTargets = toCSV({
    columns: [
      { key: "category", label: "Category" },
      { key: "savingsOpportunity", label: "Savings" },
      { key: "pctOfTotalBenefit", label: "% of Benefit", format: (v) => pct1((v as number) * 100) },
      { key: "cumulativeBenefitPct", label: "Cumulative Benefit", format: (v) => pct1((v as number) * 100) },
      { key: "volumeSharePct", label: "Behavior Change", format: (v) => pct1((v as number) * 100) },
      { key: "aboveBenchmarkAsp", label: "Above Benchmark ASP", format: (v) => (v ? "Yes" : "No") },
    ],
    rows: model.conversionTargets.targets as unknown as Record<string, unknown>[],
  })

  const conversionHeadline = toCSV({
    columns: [{ key: "headline", label: "Headline" }],
    rows: model.conversionTargets.headline
      ? [{ headline: model.conversionTargets.headline }]
      : [],
  })

  const managedCare = toCSV({
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value" },
    ],
    rows: [
      { metric: "Reimbursement low", value: `${model.managedCare.lowPct}% of Medicare` },
      { metric: "Reimbursement high", value: `${model.managedCare.highPct}% of Medicare` },
      { metric: "Midpoint", value: `${model.managedCare.midpointPct}% of Medicare` },
      { metric: "Insight", value: model.managedCare.insight },
    ],
  })

  const payback = toCSV({
    columns: [
      { key: "scenario", label: "Scenario" },
      { key: "annualBenefit", label: "Annual Benefit" },
      { key: "paybackYears", label: "Payback (yrs)", format: (v) => (v == null ? "—" : String(v)) },
    ],
    rows: [
      {
        scenario: `Investment: ${formatCurrency(model.payback.investmentCost)}`,
        annualBenefit: "",
        paybackYears: null,
      },
      ...model.payback.scenarios.map((s) => ({
        scenario: s.scenario,
        annualBenefit: s.annualBenefit,
        paybackYears: s.paybackYears,
      })),
    ],
  })

  return [
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
    "",
    "AI Prospective Impact Engine",
    "",
    "Contract Opportunity Score",
    opportunityScore,
    "",
    "EBITDA to EV Waterfall",
    waterfall,
    waterfallEv,
    "",
    "Conversion Targets",
    ...(model.conversionTargets.headline ? [conversionHeadline] : []),
    conversionTargets,
    "",
    "Managed Care Reimbursement",
    managedCare,
    "",
    "Payback Analysis",
    payback,
  ].join("\n")
}

export function downloadAnalysisCsv(
  model: DashboardModel,
  assumptions: FacilityModelAssumptions,
): void {
  triggerDownload(
    new Blob([buildAnalysisCsv(model, assumptions)], {
      type: "text/csv;charset=utf-8",
    }),
    buildReportFilename("Current State Analysis"),
  )
}

// ─── PDF (rendered SERVER-SIDE via /api/reports/pdf) ────────────
//
// All PDF generation is backend-only (Vick 2026-07-02): the client serializes
// the live model into an AnalysisReportPayload, POSTs it to /api/reports/pdf
// (type: "analysis", facility-scoped), and downloads the returned blob.

/**
 * Pure payload builder — exported so tests can assert the snapshot carries
 * every dashboard section the server generator renders.
 */
export function buildAnalysisPdfPayload(
  model: DashboardModel,
  assumptions: FacilityModelAssumptions,
  sourceLabel: string,
): AnalysisReportPayload {
  const { current, impact } = model.prospective
  return {
    sourceLabel,
    narrative: buildNarrative(model, assumptions),
    current: {
      vendorSpend: current.vendorSpend,
      netRevenue: current.netRevenue,
      ebitda: current.ebitda,
      dcf: current.dcf,
      dcfExplicit: current.dcfExplicit,
      dcfTerminalValue: current.dcfTerminalValue,
    },
    impact: {
      annualSupplySavings: impact.annualSupplySavings,
      impactToEbitda: impact.impactToEbitda,
      impactToMarginPoints: impact.impactToMarginPoints,
      impactToDistributableCashFlow: impact.impactToDistributableCashFlow,
      impactPerCase: impact.impactPerCase,
    },
    assumptions: {
      netRevenue: assumptions.netRevenue,
      currentVendorSpend: assumptions.currentVendorSpend,
      annualCaseVolume: assumptions.annualCaseVolume,
      ebitdaMarginPct: assumptions.ebitdaMarginPct,
      dcfPctOfEbitda: assumptions.dcfPctOfEbitda,
      discountRatePct: assumptions.discountRatePct,
      cashFlowGrowthPct: assumptions.cashFlowGrowthPct,
      terminalGrowthPct: assumptions.terminalGrowthPct ?? 0.03,
      dcfProjectionYears: assumptions.dcfProjectionYears,
    },
    categoryAsp: model.categoryAsp.map((c) => ({
      category: c.category,
      spend: c.spend,
      asp: c.asp,
      share: c.share,
    })),
    vendorShare: model.vendorShare.map((v) => ({
      vendor: v.vendor,
      spend: v.spend,
      share: v.share,
    })),
    contributionMargin: model.contributionMargin.map((c) => ({
      procedure: c.procedure,
      cases: c.cases,
      supplyPerCase: c.supplyPerCase,
      contributionMargin: c.contributionMargin,
      marginPct: c.marginPct,
    })),
    categoryImpact: model.categoryImpact.map((c) => ({
      category: c.category,
      cases: c.cases,
      annualImpact: c.annualImpact,
      impactPerCase: c.impactPerCase,
      marginPct: c.marginPct,
      newMarginPct: c.newMarginPct,
    })),
    enterpriseValue: impact.enterpriseValue.map((ev) => ({
      scenario: ev.scenario,
      multiple: ev.multiple,
      currentEv: ev.currentEv,
      futureEv: ev.futureEv,
      incrementalEv: ev.incrementalEv,
    })),
    ai: {
      opportunityOverall: model.opportunityScore.overall,
      opportunityTopPercentile: model.opportunityScore.topPercentile,
      waterfallFutureEbitda: model.waterfall.futureEbitda,
      waterfallIncrementalEv: model.waterfall.ev.incrementalEv,
      managedCareLowPct: model.managedCare.lowPct,
      managedCareHighPct: model.managedCare.highPct,
      paybackYears: model.payback.scenarios.map((s) => s.paybackYears),
    },
    conversionTargets: {
      headline: model.conversionTargets.headline || null,
      targets: model.conversionTargets.targets.map((t) => ({
        category: t.category,
        savingsOpportunity: t.savingsOpportunity,
        pctOfTotalBenefit: t.pctOfTotalBenefit,
        volumeSharePct: t.volumeSharePct,
        aboveBenchmarkAsp: t.aboveBenchmarkAsp,
      })),
    },
  }
}

export async function downloadAnalysisPdf(
  model: DashboardModel,
  assumptions: FacilityModelAssumptions,
  sourceLabel: string,
): Promise<void> {
  try {
    const res = await fetch("/api/reports/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "analysis",
        payload: buildAnalysisPdfPayload(model, assumptions, sourceLabel),
      }),
    })
    if (!res.ok) {
      const msg = await res.json().catch(() => null)
      throw new Error(
        (msg as { error?: string } | null)?.error ?? `Export failed (${res.status})`,
      )
    }
    triggerDownload(
      await res.blob(),
      buildReportFilename("Current State Analysis").replace(/\.csv$/, ".pdf"),
    )
    toast.success("PDF downloaded")
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to export PDF")
  }
}
