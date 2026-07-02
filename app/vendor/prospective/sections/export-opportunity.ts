/**
 * Export of the vendor Opportunity Engine deal scenario. Captures the live
 * tuned scenario + outputs + score + recommended offer (the page recalculates
 * client-side). CSV builds in the browser; the PDF serializes the snapshot
 * into an `OpportunityReportPayload` and POSTs it to /api/reports/pdf, which
 * renders it server-side (all PDF generation is backend-only — Vick 2026-07-02).
 */

import { toast } from "sonner"
import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import { formatPercent, formatCompactCurrency } from "@/lib/formatting"
import type { OpportunityReportPayload } from "@/lib/pdf"
import type { OpportunityEngineResult } from "@/lib/prospective-analysis/opportunity-engine"
import type { VendorOpportunityScore } from "@/lib/prospective-analysis/vendor-opportunity-score"
import type { FacilityCurrentStateSnapshot } from "@/components/vendor/prospective/facility-current-state"

export interface OpportunityScenarioMeta {
  /** The pitching entity — the vendor's division. */
  division: string
  /** The target facility (chosen from related facilities or written in). */
  facility: string
  priceChangePct: number
  targetShare: number
  expectedVolumeGrowthPct: number
}

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

const pct = (n: number) => formatPercent(n * 100)

/**
 * Label/value rows for the Facility Current State section — the financial
 * picture of the pitch target (spend → revenue → EBITDA → DCF + the
 * assumptions behind them). Shared by the CSV and PDF exporters so the page's
 * Export carries everything shown on the Opportunity Engine, not just the
 * deal scenario. Vick 2026-06-22.
 */
export function facilityCurrentStateRows(
  f: FacilityCurrentStateSnapshot,
): [string, string][] {
  const revenueBasis =
    f.revenueMode === "actuals"
      ? "case-costing actuals"
      : `manual: ${formatCompactCurrency(f.avgReimbursementPerCase)}/case × ${f.annualCaseVolume.toLocaleString("en-US")} cases`
  return [
    ["Facility", f.facilityName],
    ["Current vendor spend", formatCompactCurrency(f.currentVendorSpend)],
    ["Net revenue", `${formatCompactCurrency(f.netRevenue)} (${revenueBasis})`],
    ["EBITDA", `${formatCompactCurrency(f.ebitda)} (${pct(f.ebitdaMarginPct)} margin)`],
    [
      "DCF enterprise value",
      `${formatCompactCurrency(f.dcf)} (${formatCompactCurrency(f.dcfExplicit)} explicit + ${formatCompactCurrency(f.dcfTerminalValue)} terminal)`,
    ],
    ["Annual cases", f.annualCaseVolume.toLocaleString("en-US")],
    ["DCF % of EBITDA", pct(f.dcfPctOfEbitda)],
    ["Discount rate", pct(f.discountRatePct)],
    ["Cash flow growth", pct(f.cashFlowGrowthPct)],
    ["Terminal growth", pct(f.terminalGrowthPct)],
    ["DCF projection years", `${f.dcfProjectionYears} yrs`],
  ]
}

export function downloadOpportunityCsv(
  engine: OpportunityEngineResult,
  score: VendorOpportunityScore,
  scenario: OpportunityScenarioMeta,
  facility?: FacilityCurrentStateSnapshot | null,
  constructs?: ExportDealConstruct[],
): void {
  const outputs = toCSV({
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value" },
    ],
    rows: [
      { metric: "Division", value: scenario.division },
      { metric: "Facility", value: scenario.facility },
      { metric: "Price change vs ASP", value: pct(scenario.priceChangePct) },
      { metric: "Target market share", value: pct(scenario.targetShare) },
      { metric: "Expected volume growth", value: pct(scenario.expectedVolumeGrowthPct) },
      { metric: "Win probability", value: pct(engine.winProbability) },
      { metric: "Incremental revenue", value: engine.incrementalRevenue },
      { metric: "Current revenue", value: engine.currentRevenue },
      { metric: "Target revenue", value: engine.targetRevenue },
      { metric: "Net unit impact", value: Math.round(engine.netUnitImpact) },
      { metric: "Blended market share", value: pct(engine.blendedMarketShare) },
      { metric: "Territory recurring revenue", value: engine.territoryRecurringRevenue },
      { metric: "Capital / robotic revenue", value: engine.capitalRoboticRevenue },
      { metric: "Opportunity score", value: `${score.overall} / 100` },
    ],
  })

  const dims = toCSV({
    columns: [
      { key: "group", label: "Group" },
      { key: "label", label: "Dimension" },
      { key: "weight", label: "Weight" },
      { key: "scoreVal", label: "Score" },
    ],
    rows: [
      ...score.financial.map((d) => ({ group: "Financial", label: d.label, weight: d.weight, scoreVal: Math.round(d.score) })),
      ...score.strategic.map((d) => ({ group: "Strategic", label: d.label, weight: d.weight, scoreVal: Math.round(d.score) })),
    ],
  })

  const facilityBlock = facility
    ? [
        "Facility Current State",
        toCSV({
          columns: [
            { key: "metric", label: "Metric" },
            { key: "value", label: "Value" },
          ],
          rows: facilityCurrentStateRows(facility).map(([metric, value]) => ({
            metric,
            value,
          })),
        }),
        "",
      ]
    : []

  const constructBlock =
    constructs && constructs.length > 0
      ? [
          "Proposed Deal — by product",
          toCSV({
            columns: [
              { key: "productName", label: "Product" },
              { key: "current", label: "Current" },
              { key: "floor", label: "Floor" },
              { key: "target", label: "Target" },
              { key: "ask", label: "Ask" },
              { key: "annualVolume", label: "Volume" },
              { key: "rebatePercent", label: "Rebate %" },
            ],
            rows: constructs.map((c) => ({ ...c })),
          }),
          "",
        ]
      : []

  const csv = [
    ...facilityBlock,
    ...constructBlock,
    "Opportunity Engine — Deal Scenario",
    outputs,
    "",
    "Vendor Opportunity Score",
    dims,
    "",
    "Recommended Offer (target " + score.recommendedOffer.targetConversionPct + "% conversion)",
    score.recommendedOffer.items.map((i) => `,${i.replace(/,/g, ";")}`).join("\n"),
  ].join("\n")

  triggerDownload(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    buildReportFilename("Opportunity Engine Scenario"),
  )
}

/** Per-construct deal row for the export's by-product breakdown (structurally
 *  matches OppDealConstructRow — defined here to avoid an import cycle). */
export interface ExportDealConstruct {
  productName: string
  current: number
  floor: number
  target: number
  ask: number
  annualVolume: number
  rebatePercent: number
}

// ─── PDF (rendered SERVER-SIDE via /api/reports/pdf) ────────────
//
// All PDF generation is backend-only (Vick 2026-07-02): the client serializes
// the live scenario/score/snapshot into an OpportunityReportPayload, POSTs it
// to /api/reports/pdf (type: "opportunity", vendor-scoped), and downloads the
// returned blob.

/**
 * Pure payload builder — exported so tests can assert the snapshot carries
 * every section the server generator renders. The Facility Current State rows
 * are pre-formatted through `facilityCurrentStateRows` (the ONE builder shared
 * with the CSV export) so the two exports can't drift.
 */
export function buildOpportunityPdfPayload(
  engine: OpportunityEngineResult,
  score: VendorOpportunityScore,
  scenario: OpportunityScenarioMeta,
  facility?: FacilityCurrentStateSnapshot | null,
  constructs?: ExportDealConstruct[],
): OpportunityReportPayload {
  return {
    scenario: {
      division: scenario.division,
      facility: scenario.facility,
      priceChangePct: scenario.priceChangePct,
      targetShare: scenario.targetShare,
      expectedVolumeGrowthPct: scenario.expectedVolumeGrowthPct,
    },
    engine: {
      winProbability: engine.winProbability,
      incrementalRevenue: engine.incrementalRevenue,
      currentRevenue: engine.currentRevenue,
      targetRevenue: engine.targetRevenue,
      netUnitImpact: engine.netUnitImpact,
      blendedMarketShare: engine.blendedMarketShare,
      territoryRecurringRevenue: engine.territoryRecurringRevenue,
      capitalRoboticRevenue: engine.capitalRoboticRevenue,
    },
    score: {
      overall: score.overall,
      winProbability: {
        probability: score.winProbability.probability,
        riskLevel: score.winProbability.riskLevel,
        recommendedAction: score.winProbability.recommendedAction,
      },
      recommendedOffer: {
        targetConversionPct: score.recommendedOffer.targetConversionPct,
        items: [...score.recommendedOffer.items],
      },
    },
    facility: facility
      ? {
          facilityName: facility.facilityName,
          rows: facilityCurrentStateRows(facility),
        }
      : null,
    constructs: (constructs ?? []).map((c) => ({
      productName: c.productName,
      current: c.current,
      floor: c.floor,
      target: c.target,
      ask: c.ask,
      annualVolume: c.annualVolume,
      rebatePercent: c.rebatePercent,
    })),
  }
}

export async function downloadOpportunityPdf(
  engine: OpportunityEngineResult,
  score: VendorOpportunityScore,
  scenario: OpportunityScenarioMeta,
  facility?: FacilityCurrentStateSnapshot | null,
  constructs?: ExportDealConstruct[],
): Promise<void> {
  try {
    const res = await fetch("/api/reports/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "opportunity",
        payload: buildOpportunityPdfPayload(
          engine,
          score,
          scenario,
          facility,
          constructs,
        ),
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
      buildReportFilename("Opportunity Engine Scenario").replace(/\.csv$/, ".pdf"),
    )
    toast.success("PDF downloaded")
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to export PDF")
  }
}
