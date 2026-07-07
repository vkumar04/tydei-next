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
import {
  buildOpportunityNarrative,
  buildFacilityProposalNarrative,
  facilityProposedPrice,
} from "@/lib/prospective-analysis/opportunity-narrative"
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

/**
 * Two report formats (John, bugs.rtfd 2026-07-07): "internal" is the full
 * vendor working document (win probability, opportunity score, negotiation
 * ladder, recommended offer); "facility" is the version the vendor HANDS TO
 * THE FACILITY — proposed pricing + savings + rebate only, with every
 * vendor-internal lever (score, win probability, Floor/Target ladder,
 * recommended offer, facility financial model) stripped.
 */
export type OpportunityReportAudience = "internal" | "facility"

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
    // Honest label: this is the FACILITY'S total supply spend (two-way
    // sourced), not the caller's own sales — mirrors the panel's copy.
    ["Facility supply spend", formatCompactCurrency(f.currentVendorSpend)],
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

/**
 * Facility-facing per-product rows + summary — the ONE builder shared by the
 * facility CSV and the facility PDF payload so the two can't drift. The
 * presented price is the ASK (opening position), falling back to Target when
 * no Ask was entered (`facilityProposedPrice`); Floor/Target never appear.
 */
export function facilityProposalTable(constructs: ExportDealConstruct[]): {
  head: string[]
  rows: string[][]
  summary: [string, string][]
} {
  const usdFull = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`
  const rows = constructs.map((c) => {
    const proposed = facilityProposedPrice(c)
    const savings = (c.current - proposed) * c.annualVolume
    return [
      c.productName,
      c.category || "—",
      c.current > 0 ? usdFull(c.current) : "—",
      proposed > 0 ? usdFull(proposed) : "—",
      c.annualVolume.toLocaleString("en-US"),
      `${c.rebatePercent}%`,
      c.current > 0 && proposed > 0 ? usdFull(savings) : "—",
    ]
  })
  const currentSpend = constructs.reduce(
    (s, c) => s + Math.max(0, c.current) * Math.max(0, c.annualVolume),
    0,
  )
  const proposedSpend = constructs.reduce(
    (s, c) =>
      s + Math.max(0, facilityProposedPrice(c)) * Math.max(0, c.annualVolume),
    0,
  )
  const rebateValue = constructs.reduce(
    (s, c) =>
      s +
      Math.max(0, facilityProposedPrice(c)) *
        Math.max(0, c.annualVolume) *
        (Math.max(0, c.rebatePercent) / 100),
    0,
  )
  const summary: [string, string][] = [
    ["Current annual spend (these products)", usdFull(currentSpend)],
    ["Proposed annual spend", usdFull(proposedSpend)],
    [
      "Estimated annual savings",
      currentSpend > 0 ? usdFull(currentSpend - proposedSpend) : "—",
    ],
    ["Estimated annual rebate value", usdFull(rebateValue)],
  ]
  return {
    head: [
      "Product",
      "Category",
      "Current price",
      "Proposed price",
      "Annual volume",
      "Rebate %",
      "Annual savings",
    ],
    rows,
    summary,
  }
}

/** CSV the vendor hands to the facility — narrative + proposed pricing +
 *  summary. No score, no win probability, no Floor/Target ladder. */
function downloadFacilityProposalCsv(
  scenario: OpportunityScenarioMeta,
  constructs: ExportDealConstruct[],
): void {
  const narrative = buildFacilityProposalNarrative({ scenario, constructs })
  const table = facilityProposalTable(constructs)
  const csv = [
    "Narrative",
    toCSV({
      columns: [{ key: "narrative", label: "Narrative" }],
      rows: narrative.map((paragraph) => ({ narrative: paragraph })),
    }),
    "",
    "Proposed Pricing — by product",
    toCSV({
      columns: table.head.map((label, i) => ({ key: `c${i}`, label })),
      rows: table.rows.map((r) =>
        Object.fromEntries(r.map((v, i) => [`c${i}`, v])),
      ),
    }),
    "",
    "Summary",
    toCSV({
      columns: [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value" },
      ],
      rows: [
        ...table.summary.map(([metric, value]) => ({ metric, value })),
        {
          metric: "Category commitment",
          value: pct(scenario.targetShare),
        },
        {
          metric: "Expected volume growth",
          value: pct(scenario.expectedVolumeGrowthPct),
        },
      ],
    }),
  ].join("\n")

  triggerDownload(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    buildReportFilename("Supply Partnership Proposal"),
  )
}

export function downloadOpportunityCsv(
  engine: OpportunityEngineResult,
  score: VendorOpportunityScore,
  scenario: OpportunityScenarioMeta,
  facility?: FacilityCurrentStateSnapshot | null,
  constructs?: ExportDealConstruct[],
  audience: OpportunityReportAudience = "internal",
): void {
  if (audience === "facility") {
    downloadFacilityProposalCsv(scenario, constructs ?? [])
    return
  }
  const narrativeCsv = toCSV({
    columns: [{ key: "narrative", label: "Narrative" }],
    rows: buildOpportunityNarrative({
      scenario,
      engine,
      score,
      facility,
      constructs,
    }).map((paragraph) => ({ narrative: paragraph })),
  })

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
              { key: "category", label: "Category" },
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
    "Narrative",
    narrativeCsv,
    "",
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
  category?: string
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
  audience: OpportunityReportAudience = "internal",
): OpportunityReportPayload {
  if (audience === "facility") {
    // The version the vendor HANDS TO THE FACILITY: proposed pricing +
    // savings + rebate only. Engine/score still ride the payload shape but
    // the facility branch of the server generator never renders them; the
    // facility financial model is stripped outright.
    const table = facilityProposalTable(constructs ?? [])
    return {
      audience: "facility",
      narrative: buildFacilityProposalNarrative({
        scenario,
        constructs,
      }),
      proposal: {
        head: table.head,
        rows: table.rows,
        summary: [
          ...table.summary,
          ["Category commitment", pct(scenario.targetShare)],
          [
            "Expected volume growth",
            pct(scenario.expectedVolumeGrowthPct),
          ],
        ],
      },
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
      facility: null,
      constructs: [],
    }
  }
  return {
    audience: "internal",
    narrative: buildOpportunityNarrative({
      scenario,
      engine,
      score,
      facility,
      constructs,
    }),
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
      category: c.category,
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
  audience: OpportunityReportAudience = "internal",
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
          audience,
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
      buildReportFilename(
        audience === "facility"
          ? "Supply Partnership Proposal"
          : "Opportunity Engine Scenario",
      ).replace(/\.csv$/, ".pdf"),
    )
    toast.success("PDF downloaded")
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to export PDF")
  }
}
