import { describe, expect, it } from "vitest"

/**
 * Charles 2026-07-28 → Vick 2026-07-29: "these should fill in from the loaded
 * benchmark file."
 *
 * The first answer to this was an EXPLANATION, on the belief that his benchmark
 * file was two columns (Construct | National Avg Price) and the missing cells
 * were therefore unfillable. The real workbook is nine columns: Current Pricing
 * and TRL 12 Units were in the file all along and the importer dropped them.
 * They now import (`currentPrice` / `annualUnits`) and seed the construct
 * directly, so `addBenchmarkConstruct` reads:
 *
 *   current = currentPrice > 0 ? currentPrice : <price file by SKU>
 *   volume  = annualUnits  > 0 ? annualUnits  : <usage file by SKU>
 *   floor   = minPrice     > 0 ? minPrice     : percentile25
 *   target  = percentile50 > 0 ? percentile50 : nationalAvgPrice
 *
 * Ask has no source at all — it is the vendor's opening position, typed by
 * hand — so it is never a "blank reason".
 *
 * This mirrors the derivation in DealScorerSection so the reasons stay tied to
 * the same inputs the auto-fill actually reads: whichever cell is still blank,
 * the note must name BOTH places it could have come from, or it sends the
 * vendor to fix the wrong file.
 */
type Construct = {
  benchmarkId: string | null
  floor: string
  current: string
  annualVolume: string
}

function blankReasons(
  constructs: Construct[],
  priceLoadedCount: number,
  usageLoadedCount: number,
): string[] {
  const fromBenchmark = constructs.filter((c) => c.benchmarkId)
  if (fromBenchmark.length === 0) return []
  const reasons: string[] = []
  if (fromBenchmark.some((c) => !c.floor)) {
    reasons.push(
      "Floor needs a Min / Hard Floor or 25th-percentile column, which your benchmark file does not have",
    )
  }
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

/** What Charles's screenshot showed: Target seeded, everything else blank. */
const BLANK_ROW: Construct = {
  benchmarkId: "b-cemented-knee",
  floor: "",
  current: "",
  annualVolume: "",
}

describe("why a benchmark construct's cells are blank", () => {
  it("names all three causes when neither the benchmark file nor the side files carry them", () => {
    const r = blankReasons([BLANK_ROW], 0, 0)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatch(/Min \/ Hard Floor or 25th-percentile/)
    expect(r[1]).toMatch(/price file \(none loaded\)/)
    expect(r[2]).toMatch(/usage file \(none loaded\)/)
  })

  it("names the benchmark file's own column as a source, not just the side file", () => {
    // The 2026-07-28 copy said Current "comes from a price file" full stop.
    // That was the bug's cover story: it pointed the vendor at the wrong
    // upload while the number sat unread in the benchmark file he'd loaded.
    const r = blankReasons([BLANK_ROW], 0, 0)
    expect(r[1]).toMatch(/Current price column on the benchmark file/)
    expect(r[2]).toMatch(/Annual units column on the benchmark file/)
  })

  it("distinguishes 'file not loaded' from 'loaded but did not match'", () => {
    // A loaded file that simply has no row for this item number is a DIFFERENT
    // problem — telling the user to upload a file they already uploaded would
    // send them down the wrong path.
    const r = blankReasons([BLANK_ROW], 12, 12)
    expect(r[1]).toMatch(/did not match|have neither/)
    expect(r[2]).toMatch(/did not match|have neither/)
    expect(r.join(" ")).not.toMatch(/none loaded/)
  })

  it("says nothing when the benchmark file carried the columns", () => {
    // The 2026-07-29 shape: Current + Volume seeded from the benchmark row
    // itself, with no price or usage file loaded at all.
    const seededFromBenchmark: Construct = {
      benchmarkId: "b-full",
      floor: "2850",
      current: "3800",
      annualVolume: "240",
    }
    expect(blankReasons([seededFromBenchmark], 0, 0)).toEqual([])
  })

  it("ignores hand-added custom rows — blanks there are the user's own", () => {
    const custom: Construct = {
      benchmarkId: null,
      floor: "",
      current: "",
      annualVolume: "",
    }
    expect(blankReasons([custom], 0, 0)).toEqual([])
  })

  it("reports a cause when ANY benchmark row is missing it, not only all", () => {
    const full: Construct = {
      benchmarkId: "b-full",
      floor: "2800",
      current: "3200",
      annualVolume: "300",
    }
    const r = blankReasons([full, BLANK_ROW], 1, 1)
    expect(r).toHaveLength(3)
  })
})
