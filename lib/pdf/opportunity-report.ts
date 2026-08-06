import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { formatCompactCurrency, formatPercent } from "@/lib/formatting"
import { getFinalY, toBytes } from "./shared"

// ─── Vendor Opportunity Engine export (Deal Scenario) ─────────────
//
// Same server-side pattern: the Opportunity Engine page recalculates
// client-side, serializes the live scenario/score/snapshot into this payload,
// and POSTs it (type: "opportunity").

export interface OpportunityReportPayload {
  /**
   * Report format (John's two-format ask, bugs.rtfd 2026-07-07): "internal"
   * (default; the vendor's full working document) or "facility" (the version
   * handed to the facility — proposed pricing + savings + rebate only; the
   * generator's facility branch never renders engine/score/offer sections).
   */
  audience?: "internal" | "facility"
  /**
   * Facility-facing proposed-pricing table + summary (audience "facility"
   * only) — pre-formatted client-side by `facilityProposalTable` (the ONE
   * builder shared with the facility CSV).
   */
  proposal?: {
    head: string[]
    rows: string[][]
    summary: [string, string][]
  } | null
  /**
   * Plain-English story paragraphs (buildOpportunityNarrative, client-side) —
   * rendered as section 1, before the Facility Current State table.
   */
  narrative: string[]
  scenario: {
    division: string
    facility: string
    /** Fractions (0.05 = 5%). */
    priceChangePct: number
    targetShare: number
    expectedVolumeGrowthPct: number
  }
  engine: {
    winProbability: number
    incrementalRevenue: number
    currentRevenue: number
    targetRevenue: number
    netUnitImpact: number
    blendedMarketShare: number
    territoryRecurringRevenue: number
    capitalRoboticRevenue: number
  }
  score: {
    overall: number
    winProbability: {
      probability: number
      riskLevel: string
      recommendedAction: string
    }
    recommendedOffer: { targetConversionPct: number; items: string[] }
  }
  /**
   * Facility Current State — pre-formatted label/value rows built client-side
   * by facilityCurrentStateRows (the ONE builder shared with the CSV export).
   */
  facility: { facilityName: string; rows: [string, string][] } | null
  /** Per-construct deal rows (present when reached via the stepper). */
  constructs: {
    productName: string
    category?: string
    current: number
    floor: number
    target: number
    ask: number
    annualVolume: number
    rebatePercent: number
  }[]
}

export function generateOpportunityReportPDF(
  payload: OpportunityReportPayload,
): Uint8Array {
  const { scenario, engine, score } = payload
  const pct = (n: number) => formatPercent(n * 100)
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

  const doc = new jsPDF({ unit: "pt", format: "letter" })
  const margin = 40
  let y = margin

  const facilityFacing = payload.audience === "facility"
  doc.setFontSize(18)
  doc.text(
    facilityFacing
      ? "Supply Partnership Proposal"
      : "Opportunity Engine — Deal Scenario",
    margin,
    y,
  )
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

  // Narrative — tell the story before the tables (mirrors the Analysis
  // export). `?? []` guards payloads posted by an older client.
  doc.setFontSize(10)
  for (const paragraph of payload.narrative ?? []) {
    const lines = doc.splitTextToSize(paragraph, 515) as string[]
    doc.text(lines, margin, y)
    y += lines.length * 13 + 6
  }
  y += 2

  const after = (fallback: number) => getFinalY(doc, fallback + 20)

  // Facility-facing format (John's two-format ask, bugs.rtfd 2026-07-07):
  // proposed pricing + summary ONLY — no win probability, no opportunity
  // score, no recommended offer, no Floor/Target ladder, no facility
  // financial model. Everything is pre-formatted client-side in
  // payload.proposal (facilityProposalTable, shared with the facility CSV).
  if (facilityFacing) {
    const proposal = payload.proposal
    if (proposal && proposal.rows.length > 0) {
      doc.setFontSize(12)
      doc.text("Proposed Pricing — by product", margin, y + 6)
      autoTable(doc, {
        startY: y + 12,
        head: [proposal.head],
        body: proposal.rows,
        theme: "striped",
        headStyles: { fillColor: [30, 41, 59] },
        styles: { fontSize: 8 },
      })
      y = after(y)
    }
    doc.setFontSize(12)
    doc.text("Summary", margin, y + 6)
    autoTable(doc, {
      startY: y + 12,
      head: [["Metric", "Value"]],
      body: proposal?.summary ?? [],
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 9 },
    })
    return toBytes(doc)
  }

  // Facility Current State — the financial picture of the pitch target.
  if (payload.facility) {
    doc.setFontSize(12)
    doc.text(
      `Facility Current State — ${payload.facility.facilityName}`,
      margin,
      y + 6,
    )
    autoTable(doc, {
      startY: y + 12,
      head: [["Metric", "Value"]],
      body: payload.facility.rows,
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
      [
        "Incremental revenue",
        `+${formatCompactCurrency(engine.incrementalRevenue)} (${formatCompactCurrency(engine.currentRevenue)} → ${formatCompactCurrency(engine.targetRevenue)})`,
      ],
      ["Net unit impact", `+${Math.round(engine.netUnitImpact)}`],
      ["Blended market share", pct(engine.blendedMarketShare)],
      ["Territory recurring revenue", formatCompactCurrency(engine.territoryRecurringRevenue)],
      ["Capital / robotic revenue", formatCompactCurrency(engine.capitalRoboticRevenue)],
      ["Opportunity score", `${score.overall} / 100`],
      [
        "AI win probability",
        `${pct(score.winProbability.probability)} (risk ${score.winProbability.riskLevel})`,
      ],
      ["Recommended action", score.winProbability.recommendedAction],
    ],
    theme: "striped",
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
  })
  y = after(y)

  // Proposed Deal — by product (the per-construct breakdown of the deal built
  // in step 1; present when the export was reached via the stepper).
  if (payload.constructs.length > 0) {
    doc.setFontSize(12)
    doc.text("Proposed Deal — by product", margin, y + 6)
    autoTable(doc, {
      startY: y + 12,
      head: [["Product", "Category", "Current", "Floor", "Target", "Ask", "Volume", "Rebate %"]],
      body: payload.constructs.map((c) => [
        c.productName,
        c.category || "—",
        usd(c.current),
        usd(c.floor),
        usd(c.target),
        usd(c.ask),
        c.annualVolume.toLocaleString(),
        `${c.rebatePercent}%`,
      ]),
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 8 },
    })
    y = after(y)
  }

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

  return toBytes(doc)
}
