/**
 * Why a benchmark-picked construct still has empty cells. Derived during
 * render (never mirrored into state) from the same inputs the auto-fill reads,
 * so it cannot drift from what actually happened.
 *
 * NOTE: __tests__/construct-blank-reasons.test.ts pins these reason strings by
 * verbatim duplication — keep them byte-identical with the mirror there.
 */

/** The construct fields the blank-reason derivation reads (a structural
 *  subset of ConstructForm). */
export interface BlankReasonConstruct {
  benchmarkId: string | null
  floor: string
  current: string
  annualVolume: string
}

export function computeConstructBlankReasons(
  constructs: BlankReasonConstruct[],
  priceLoadedCount: number,
  usageLoadedCount: number,
): string[] {
  const fromBenchmark = constructs.filter((c) => c.benchmarkId)
  if (fromBenchmark.length === 0) return []
  const reasons: string[] = []
  if (fromBenchmark.some((c) => !c.floor)) {
    // benchFloor = minPrice || percentile25 — both absent in a national-avg-
    // only file, which is the shape the import dialog now warns about too.
    reasons.push(
      "Floor needs a Min / Hard Floor or 25th-percentile column, which your benchmark file does not have",
    )
  }
  // Current and Volume each have TWO sources since 2026-07-29 — the
  // benchmark row's own column first, then the side file — so name both,
  // or the note sends the vendor to fix the wrong file.
  if (fromBenchmark.some((c) => !c.current)) {
    reasons.push(
      priceLoadedCount > 0
        ? "Current needs a Current price column on the benchmark file, or a price-file row matching the item number — these products have neither"
        : "Current needs a Current price column on the benchmark file, or a price file (none loaded)",
    )
  }
  if (fromBenchmark.some((c) => !c.annualVolume)) {
    reasons.push(
      usageLoadedCount > 0
        ? "Volume needs an Annual units column on the benchmark file, or a usage-file row matching the item number — these products have neither"
        : "Volume needs an Annual units column on the benchmark file, or a usage file (none loaded)",
    )
  }
  return reasons
}
