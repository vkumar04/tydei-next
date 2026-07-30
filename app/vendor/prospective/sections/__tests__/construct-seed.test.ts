/**
 * Which number lands in each Deal-Scorer cell when a benchmark is picked.
 *
 * Charles 2026-07-28 → Vick 2026-07-29 ("these should fill in from the loaded
 * benchmark file"): the benchmark file's own Current Pricing / TRL 12 Units
 * columns were dropped at import, so Current and Volume could only ever come
 * from the side uploads — and stayed blank when those weren't loaded. They now
 * seed from the picked row first. Target and Ask are entered by hand.
 */
import { describe, expect, it } from "vitest"
import {
  seedConstructFromBenchmark,
  type ConstructSeedBenchmark,
} from "../construct-seed"

/** A row with nothing in it — each test lights up only the fields it means to. */
const EMPTY: ConstructSeedBenchmark = {
  currentPrice: 0,
  annualUnits: 0,
  minPrice: 0,
  percentile25: 0,
  percentile50: 0,
  nationalAvgPrice: 0,
}

const bench = (over: Partial<ConstructSeedBenchmark>): ConstructSeedBenchmark => ({
  ...EMPTY,
  ...over,
})

/** Row 1 of the real workbook (Benchmarks.xlsx, 2026-07-29). */
const CEMENTED_KNEE = bench({
  currentPrice: 3800, // Current Pricing
  annualUnits: 0, // TRL 12 Units — empty in the file as sent
  minPrice: 2850, // Hard Floor
  nationalAvgPrice: 3300, // National ASP
})

describe("seedConstructFromBenchmark — the real workbook", () => {
  it("fills Current, Floor and Target from the benchmark row alone", () => {
    // No price file, no usage file: exactly the state the screenshot showed.
    expect(seedConstructFromBenchmark(CEMENTED_KNEE)).toEqual({
      current: "3800",
      floor: "2850",
      target: "3300",
      annualVolume: "", // TRL 12 Units is blank in the file
    })
  })

  it("never emits an Ask — it is typed by hand", () => {
    const seeded = seedConstructFromBenchmark(
      bench({ currentPrice: 3800, nationalAvgPrice: 3300, minPrice: 2850 }),
      { price: 4000, volume: 100 },
    )
    expect(seeded).not.toHaveProperty("ask")
  })

  it("fills Volume too once the units column carries numbers", () => {
    const seeded = seedConstructFromBenchmark(
      bench({ ...CEMENTED_KNEE, annualUnits: 240 }),
    )
    expect(seeded.annualVolume).toBe("240")
  })
})

describe("seedConstructFromBenchmark — precedence", () => {
  it("prefers the benchmark row over the price and usage files", () => {
    // The row is what the vendor picked and what he can see on screen; a side
    // file may be stale or absent. Both sources present → the row wins.
    const seeded = seedConstructFromBenchmark(
      bench({ currentPrice: 3800, annualUnits: 240, nationalAvgPrice: 3300 }),
      { price: 9999, volume: 8888 },
    )
    expect(seeded.current).toBe("3800")
    expect(seeded.annualVolume).toBe("240")
  })

  it("falls back to the price and usage files when the row has neither", () => {
    // The pre-2026-07-29 behaviour, which must keep working for every vendor
    // whose benchmark file carries only market columns.
    const seeded = seedConstructFromBenchmark(
      bench({ nationalAvgPrice: 3300, minPrice: 2850 }),
      { price: 4000, volume: 120 },
    )
    expect(seeded.current).toBe("4000")
    expect(seeded.annualVolume).toBe("120")
    expect(seeded.target).toBe("3300")
    expect(seeded.floor).toBe("2850")
  })

  it("treats an absent column (0) as absent, not as a real zero", () => {
    // getVendorBenchmarks maps NULL to 0, so 0 is the ONLY signal for "the
    // file didn't carry this". A 0 that seeded the cell would put a $0 price
    // and a 0-unit volume into the blend and score a deal off nothing.
    const seeded = seedConstructFromBenchmark(bench({ nationalAvgPrice: 3300 }))
    expect(seeded.current).toBe("")
    expect(seeded.annualVolume).toBe("")
    expect(seeded.floor).toBe("")
  })

  it("leaves a cell blank when neither source has it", () => {
    expect(seedConstructFromBenchmark(EMPTY)).toEqual({
      current: "",
      floor: "",
      target: "",
      annualVolume: "",
    })
  })
})

describe("seedConstructFromBenchmark — market-column fallbacks", () => {
  it("Floor prefers Min / Hard Floor, then P25", () => {
    expect(
      seedConstructFromBenchmark(bench({ minPrice: 2800, percentile25: 3100 }))
        .floor,
    ).toBe("2800")
    expect(
      seedConstructFromBenchmark(bench({ percentile25: 3100 })).floor,
    ).toBe("3100")
  })

  it("Target prefers the median, then the national average", () => {
    expect(
      seedConstructFromBenchmark(
        bench({ percentile50: 3250, nationalAvgPrice: 3300 }),
      ).target,
    ).toBe("3250")
    expect(
      seedConstructFromBenchmark(bench({ nationalAvgPrice: 3300 })).target,
    ).toBe("3300")
  })

  it("keeps Target on a market number even when the row has a Current price", () => {
    // Target is the vendor's own figure. Seeding it from Current Pricing would
    // silently propose holding today's price as the target.
    expect(
      seedConstructFromBenchmark(
        bench({ currentPrice: 3800, nationalAvgPrice: 3300 }),
      ).target,
    ).toBe("3300")
  })

  it("emits plain numeric strings the number inputs accept", () => {
    // The cells bind to <Input type="number">: a formatted "$3,800.00" would
    // render as an empty box and the value would be lost on save.
    const seeded = seedConstructFromBenchmark(
      bench({ currentPrice: 3800.5, minPrice: 2850, annualUnits: 240 }),
    )
    for (const v of [seeded.current, seeded.floor, seeded.annualVolume]) {
      expect(v).toMatch(/^\d+(\.\d+)?$/)
      expect(Number(v)).not.toBeNaN()
    }
    expect(seeded.current).toBe("3800.5")
  })
})
