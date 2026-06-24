/**
 * Usage history → Deal-Scorer construct seeds.
 *
 * The vendor's uploaded 12-month usage (parsed + SKU-aggregated into
 * `ProposalProduct[]` by the proposal builder's `mapUsageRows`, optionally
 * merged with a proposed-pricing file) is the SOURCE of the construct rows —
 * each product becomes one row pre-filled with its current price + annual
 * volume, so "Analyze deal" runs on REAL usage instead of hand-typed numbers
 * (Vick 2026-06-24: "I don't think it is using the usage").
 *
 * Pure + UI-agnostic: returns numeric seeds; the Deal Scorer maps them to its
 * string-input `ConstructForm` rows (adding `_uid`).
 */

/** Minimal product shape we read (subset of builder `ProposalProduct`). */
export interface UsageProductLike {
  benchmarkId?: string | null
  productName: string
  /** Current price the facility pays today (from usage history). */
  historicalAvgPrice?: number | null
  /** Annual volume from the 12-month usage history. */
  historicalAvgVolume?: number | null
  /** Proposed unit price (from a matched proposed-pricing file) → the Ask. */
  proposedPrice?: number | null
  /** Fallback volume when no historical volume is present. */
  projectedVolume?: number | null
}

export interface ConstructSeed {
  benchmarkId: string | null
  productName: string
  current: number
  floor: number
  target: number
  ask: number
  annualVolume: number
  rebatePercent: number
}

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

/**
 * Map usage-aggregated products to construct seeds. `current` comes from the
 * historical paid price, `ask` from the matched proposed price (0 until the
 * vendor enters one), `annualVolume` from historical (else projected). Floor /
 * Target are left for the vendor to enter. Products with no name are dropped.
 */
export function usageProductsToConstructs(
  products: UsageProductLike[],
): ConstructSeed[] {
  return products
    .filter((p) => p.productName?.trim())
    .map((p) => ({
      benchmarkId: p.benchmarkId && p.benchmarkId.length > 0 ? p.benchmarkId : null,
      productName: p.productName.trim(),
      current: n(p.historicalAvgPrice),
      floor: 0,
      target: 0,
      ask: n(p.proposedPrice),
      annualVolume: n(p.historicalAvgVolume) || n(p.projectedVolume),
      rebatePercent: 0,
    }))
}
