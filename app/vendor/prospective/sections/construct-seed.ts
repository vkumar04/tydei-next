/**
 * What a Deal-Scorer construct's cells are seeded with when the vendor picks a
 * benchmark ("Add from benchmark…").
 *
 * Pure and separate from DealScorerSection so the precedence rule is pinned by
 * tests instead of living inside a 1,500-line component — the blank-cell copy
 * next to the table derives from the SAME rule, and the two drifting apart is
 * how "these should fill in from the loaded benchmark file" (Charles 2026-07-28)
 * got answered with an explanation naming the wrong file.
 *
 * Precedence: the benchmark ROW the vendor picked wins, then the separately
 * uploaded price / usage files matched by SKU. The row is the thing he chose
 * and the number he can see; a side file may not be loaded at all.
 *
 * Ask is absent by design — it is the vendor's opening position, typed by hand
 * (Vick 2026-07-29). No file column seeds it, including a "TRG"-style target
 * column, and Target's seed stays a market number for the same reason: a
 * benchmark pick must never overwrite a figure he means to enter himself.
 */

/** The benchmark fields the seed reads (a structural subset of VendorBenchmarkRow). */
export interface ConstructSeedBenchmark {
  /** From the benchmark file's "Current Pricing"-style column. 0 = absent. */
  currentPrice: number
  /** From the benchmark file's "TRL 12 Units"-style column. 0 = absent. */
  annualUnits: number
  minPrice: number
  percentile25: number
  percentile50: number
  nationalAvgPrice: number
}

/** Values found for this SKU in the separately uploaded price / usage files. */
export interface ConstructSeedFallbacks {
  price?: number
  volume?: number
}

/** The construct form's numeric cells, as the strings the inputs bind to. */
export interface ConstructSeedValues {
  current: string
  floor: string
  target: string
  annualVolume: string
}

/** A form cell: only a positive number is worth seeding; anything else is blank. */
function cell(value: number | undefined): string {
  return value != null && value > 0 ? String(value) : ""
}

export function seedConstructFromBenchmark(
  b: ConstructSeedBenchmark,
  fallbacks: ConstructSeedFallbacks = {},
): ConstructSeedValues {
  return {
    // Benchmark file's own column first, then the price / usage upload.
    current: cell(b.currentPrice > 0 ? b.currentPrice : fallbacks.price),
    annualVolume: cell(b.annualUnits > 0 ? b.annualUnits : fallbacks.volume),
    // Market columns: the bottom of the range, then the middle of it.
    floor: cell(b.minPrice > 0 ? b.minPrice : b.percentile25),
    target: cell(b.percentile50 > 0 ? b.percentile50 : b.nationalAvgPrice),
  }
}
