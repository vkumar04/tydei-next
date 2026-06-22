/**
 * Client-side export of the vendor Opportunity Engine deal scenario. Captures
 * the live tuned scenario + outputs + score + recommended offer (the page
 * recalculates client-side, so this runs in the browser off the live result).
 */

import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import { formatPercent, formatCompactCurrency } from "@/lib/formatting"
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

  const csv = [
    ...facilityBlock,
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

export async function downloadOpportunityPdf(
  engine: OpportunityEngineResult,
  score: VendorOpportunityScore,
  scenario: OpportunityScenarioMeta,
  facility?: FacilityCurrentStateSnapshot | null,
): Promise<void> {
  const { jsPDF } = await import("jspdf")
  const autoTable = (await import("jspdf-autotable")).default

  const doc = new jsPDF({ unit: "pt", format: "letter" })
  const margin = 40
  let y = margin

  doc.setFontSize(18)
  doc.text("Opportunity Engine — Deal Scenario", margin, y)
  y += 18
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(
    `${scenario.division} · ${scenario.facility} · ${new Date().toLocaleDateString("en-US")}`,
    margin,
    y,
  )
  doc.setTextColor(0)
  y += 16

  const after = (fallback: number) =>
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? fallback + 20

  // Facility Current State — the financial picture of the pitch target.
  if (facility) {
    doc.setFontSize(12)
    doc.text(`Facility Current State — ${facility.facilityName}`, margin, y + 6)
    autoTable(doc, {
      startY: y + 12,
      head: [["Metric", "Value"]],
      body: facilityCurrentStateRows(facility),
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 9 },
    })
    y = after(y)
  }

  autoTable(doc, {
    startY: y,
    head: [["Lever", "Value"]],
    body: [
      ["Division", scenario.division],
      ["Facility", scenario.facility],
      ["Price change vs ASP", pct(scenario.priceChangePct)],
      ["Target market share", pct(scenario.targetShare)],
      ["Expected volume growth", pct(scenario.expectedVolumeGrowthPct)],
    ],
    theme: "striped",
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
  })
  y = after(y)

  autoTable(doc, {
    startY: y + 6,
    head: [["Outcome", "Value"]],
    body: [
      ["Win probability", pct(engine.winProbability)],
      ["Incremental revenue", `+${formatCompactCurrency(engine.incrementalRevenue)} (${formatCompactCurrency(engine.currentRevenue)} → ${formatCompactCurrency(engine.targetRevenue)})`],
      ["Net unit impact", `+${Math.round(engine.netUnitImpact)}`],
      ["Blended market share", pct(engine.blendedMarketShare)],
      ["Territory recurring revenue", formatCompactCurrency(engine.territoryRecurringRevenue)],
      ["Capital / robotic revenue", formatCompactCurrency(engine.capitalRoboticRevenue)],
      ["Opportunity score", `${score.overall} / 100`],
      ["AI win probability", `${pct(score.winProbability.probability)} (risk ${score.winProbability.riskLevel})`],
      ["Recommended action", score.winProbability.recommendedAction],
    ],
    theme: "striped",
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
  })
  y = after(y)

  doc.setFontSize(12)
  doc.text(
    `Recommended Offer — ${score.recommendedOffer.targetConversionPct}% conversion`,
    margin,
    y + 6,
  )
  autoTable(doc, {
    startY: y + 12,
    head: [["Offer lever"]],
    body: score.recommendedOffer.items.map((i) => [i]),
    theme: "striped",
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
  })

  doc.save(
    buildReportFilename("Opportunity Engine Scenario").replace(/\.csv$/, ".pdf"),
  )
}
