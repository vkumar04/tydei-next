/**
 * Data pipeline — PO-level on-contract summary.
 *
 * Reference: docs/superpowers/specs/2026-04-18-data-pipeline-rewrite.md §4.4
 *
 * Pure function: takes enriched PO line items (already carrying
 * `isOnContract` via `lib/contracts/po-enrichment.ts`) and produces the
 * PO-level aggregate stats rendered on the PO list + detail pages.
 */

export interface EnrichedPOLine {
  isOnContract: boolean
  extendedPrice: number
  variance: number | null
}

export interface POSummary {
  totalLines: number
  onContractLines: number
  offContractLines: number
  offContractPercent: number // 0-100
  totalSpend: number
  onContractSpend: number
  offContractSpend: number
  totalVariance: number // sum of per-line variance (signed)
}

/** Aggregate a single PO's lines into the PO-detail summary. */
export function summarizePO(lines: EnrichedPOLine[]): POSummary {
  let onContractLines = 0
  let offContractLines = 0
  let totalSpend = 0
  let onContractSpend = 0
  let offContractSpend = 0
  let totalVariance = 0

  for (const line of lines) {
    totalSpend += line.extendedPrice
    if (line.isOnContract) {
      onContractLines++
      onContractSpend += line.extendedPrice
    } else {
      offContractLines++
      offContractSpend += line.extendedPrice
    }
    if (line.variance !== null) totalVariance += line.variance
  }

  const totalLines = lines.length
  const offContractPercent =
    totalLines > 0 ? (offContractLines / totalLines) * 100 : 0

  return {
    totalLines,
    onContractLines,
    offContractLines,
    offContractPercent,
    totalSpend,
    onContractSpend,
    offContractSpend,
    totalVariance,
  }
}

export interface POListSummary {
  /** Total number of POs across the list. */
  totalPOs: number
  /** Number of POs that have at least one off-contract line. */
  pOsWithOffContractLines: number
  /** Aggregate counts across all POs' lines. */
  totalLines: number
  totalOnContractLines: number
  totalOffContractLines: number
  totalSpend: number
  totalOnContractSpend: number
  totalOffContractSpend: number
}

/**
 * Aggregate across a list of POs for the PO-list top-of-page summary
 * (e.g., "5 of 12 POs have off-contract lines; $X off-contract spend").
 */
export function summarizePOList(
  pos: Array<{ lines: EnrichedPOLine[] }>,
): POListSummary {
  let pOsWithOffContractLines = 0
  let totalLines = 0
  let totalOnContractLines = 0
  let totalOffContractLines = 0
  let totalSpend = 0
  let totalOnContractSpend = 0
  let totalOffContractSpend = 0

  for (const po of pos) {
    const summary = summarizePO(po.lines)
    if (summary.offContractLines > 0) pOsWithOffContractLines++
    totalLines += summary.totalLines
    totalOnContractLines += summary.onContractLines
    totalOffContractLines += summary.offContractLines
    totalSpend += summary.totalSpend
    totalOnContractSpend += summary.onContractSpend
    totalOffContractSpend += summary.offContractSpend
  }

  return {
    totalPOs: pos.length,
    pOsWithOffContractLines,
    totalLines,
    totalOnContractLines,
    totalOffContractLines,
    totalSpend,
    totalOnContractSpend,
    totalOffContractSpend,
  }
}
