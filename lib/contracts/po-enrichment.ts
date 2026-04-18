/**
 * PO line enrichment against contract pricing.
 *
 * Pure helper: given a batch of PO lines + a contract pricing lookup,
 * returns each line enriched with:
 *   - isOnContract: did the vendorItemNo match a priced contract item?
 *   - contractPrice: the contract's unit price (null when off-contract)
 *   - variance / variancePercent: signed actual − contract (dollars + %)
 *   - severity: minor (<2%) | moderate (<10%) | major (≥10%) by abs value
 *
 * Severity thresholds intentionally match `price-variance.ts` so the
 * data-pipeline subsystem and the contracts UI grade discrepancies the
 * same way.
 *
 * Match semantics: vendorItemNo comparison is case-insensitive (keys
 * normalized to lowercase). Null vendorItemNo → off-contract.
 */

export interface POLineInput {
  id: string
  vendorItemNo: string | null
  unitPrice: number
  quantity: number
}

export interface ContractPriceLookupEntry {
  vendorItemNo: string
  unitPrice: number
}

export type EnrichmentSeverity = "minor" | "moderate" | "major"

export interface EnrichedPOLine {
  id: string
  vendorItemNo: string | null
  quantity: number
  unitPrice: number
  isOnContract: boolean
  contractPrice: number | null
  /** actual − contract, multiplied by quantity (signed dollars). */
  variance: number | null
  /** ((actual − contract) / contract) × 100 (signed percent). */
  variancePercent: number | null
  severity: EnrichmentSeverity | null
}

function severityFor(absPercent: number): EnrichmentSeverity {
  if (absPercent < 2) return "minor"
  if (absPercent < 10) return "moderate"
  return "major"
}

export function enrichPOLines(input: {
  lines: POLineInput[]
  pricingItems: ContractPriceLookupEntry[]
}): EnrichedPOLine[] {
  const { lines, pricingItems } = input

  // Build a case-insensitive lookup. If duplicates exist, last write wins
  // — matches the upstream contract-import convention (later rows override).
  const priceMap = new Map<string, number>()
  for (const item of pricingItems) {
    if (!item.vendorItemNo) continue
    priceMap.set(item.vendorItemNo.toLowerCase(), item.unitPrice)
  }

  const out: EnrichedPOLine[] = []

  for (const line of lines) {
    if (line.vendorItemNo === null || line.vendorItemNo === undefined) {
      out.push({
        id: line.id,
        vendorItemNo: line.vendorItemNo ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        isOnContract: false,
        contractPrice: null,
        variance: null,
        variancePercent: null,
        severity: null,
      })
      continue
    }

    const key = line.vendorItemNo.toLowerCase()
    const contractPrice = priceMap.get(key)

    if (contractPrice === undefined) {
      out.push({
        id: line.id,
        vendorItemNo: line.vendorItemNo,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        isOnContract: false,
        contractPrice: null,
        variance: null,
        variancePercent: null,
        severity: null,
      })
      continue
    }

    // Guard against zero/negative contract price — treat as off-contract
    // for variance purposes to avoid divide-by-zero.
    if (contractPrice <= 0) {
      out.push({
        id: line.id,
        vendorItemNo: line.vendorItemNo,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        isOnContract: true,
        contractPrice,
        variance: null,
        variancePercent: null,
        severity: null,
      })
      continue
    }

    const variance = (line.unitPrice - contractPrice) * line.quantity
    const variancePercent =
      ((line.unitPrice - contractPrice) / contractPrice) * 100
    const severity = severityFor(Math.abs(variancePercent))

    out.push({
      id: line.id,
      vendorItemNo: line.vendorItemNo,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      isOnContract: true,
      contractPrice,
      variance,
      variancePercent,
      severity,
    })
  }

  return out
}
