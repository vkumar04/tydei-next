import { describe, it, expect } from "vitest"
import { usageProductsToConstructs } from "../usage-to-constructs"

describe("usageProductsToConstructs", () => {
  it("maps usage products → construct seeds (current from history, ask from proposed)", () => {
    const seeds = usageProductsToConstructs([
      {
        benchmarkId: "bench-1",
        productName: "Knee implant",
        historicalAvgPrice: 1000,
        historicalAvgVolume: 500,
        proposedPrice: 900,
      },
    ])
    expect(seeds).toEqual([
      {
        benchmarkId: "bench-1",
        productName: "Knee implant",
        current: 1000,
        floor: 0,
        target: 0,
        ask: 900,
        annualVolume: 500,
        rebatePercent: 0,
      },
    ])
  })

  it("falls back to projected volume + treats empty benchmarkId as null", () => {
    const [s] = usageProductsToConstructs([
      {
        benchmarkId: "",
        productName: "Hip stem",
        historicalAvgPrice: 2000,
        projectedVolume: 120,
      },
    ])
    expect(s.benchmarkId).toBeNull()
    expect(s.annualVolume).toBe(120)
    expect(s.ask).toBe(0) // no proposed price yet
  })

  it("drops nameless products and coerces bad numbers to 0", () => {
    const seeds = usageProductsToConstructs([
      { productName: "  ", historicalAvgPrice: 5 },
      { productName: "Plate", historicalAvgPrice: null, historicalAvgVolume: undefined },
    ])
    expect(seeds).toHaveLength(1)
    expect(seeds[0]).toMatchObject({ productName: "Plate", current: 0, annualVolume: 0 })
  })
})
