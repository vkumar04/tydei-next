import { describe, expect, it } from "vitest"

/**
 * Charles 2026-07-28: "these should fill in from the loaded benchmark file."
 *
 * They cannot, and the constructs table gave no hint why — the same silent-gap
 * complaint he raised about the Benchmarks tab, resurfacing at the point of USE.
 * His benchmark rows in production carry ONLY `nationalAvgPrice`; p25, p50, min,
 * max, sampleSize and category are all NULL (verified against the prod
 * snapshot). So `addBenchmarkConstruct` seeds:
 *
 *   benchTarget = percentile50 > 0 ? percentile50 : nationalAvgPrice  → 3300 ✓
 *   benchFloor  = minPrice     > 0 ? minPrice     : percentile25      → 0, blank
 *
 * and Current/Volume come from the separately-uploaded price and usage files.
 *
 * This mirrors the derivation in DealScorerSection so the reasons stay tied to
 * the same inputs the auto-fill actually reads.
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
      "Floor needs a Min or 25th-percentile column, which your benchmark file does not have",
    )
  }
  if (fromBenchmark.some((c) => !c.current)) {
    reasons.push(
      priceLoadedCount > 0
        ? "Current is filled from the price file by item number — these products did not match one"
        : "Current comes from a price file, which is not loaded",
    )
  }
  if (fromBenchmark.some((c) => !c.annualVolume)) {
    reasons.push(
      usageLoadedCount > 0
        ? "Volume is filled from the usage file by item number — these products did not match one"
        : "Volume comes from a usage file, which is not loaded",
    )
  }
  return reasons
}

/** Exactly what Charles's screenshot shows: Target seeded, everything else blank. */
const CHARLES_ROW: Construct = {
  benchmarkId: "b-cemented-knee",
  floor: "",
  current: "",
  annualVolume: "",
}

describe("why a benchmark construct's cells are blank", () => {
  it("names all three causes for a national-avg-only file with no side files", () => {
    const r = blankReasons([CHARLES_ROW], 0, 0)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatch(/Min or 25th-percentile/)
    expect(r[1]).toMatch(/price file, which is not loaded/)
    expect(r[2]).toMatch(/usage file, which is not loaded/)
  })

  it("distinguishes 'file not loaded' from 'loaded but did not match'", () => {
    // A loaded file that simply has no row for this item number is a DIFFERENT
    // problem — telling the user to upload a file they already uploaded would
    // send them down the wrong path.
    const r = blankReasons([CHARLES_ROW], 12, 12)
    expect(r[1]).toMatch(/did not match/)
    expect(r[2]).toMatch(/did not match/)
    expect(r.join(" ")).not.toMatch(/not loaded/)
  })

  it("says nothing when the benchmark file carried the columns", () => {
    const full: Construct = {
      benchmarkId: "b-full",
      floor: "2800",
      current: "3200",
      annualVolume: "300",
    }
    expect(blankReasons([full], 1, 1)).toEqual([])
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
    const r = blankReasons([full, CHARLES_ROW], 1, 1)
    expect(r).toHaveLength(3)
  })
})
