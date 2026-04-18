import { describe, it, expect } from "vitest"
import { calculateCarveOut } from "../carve-out"
import type {
  CarveOutConfig,
  PeriodData,
  PurchaseRecord,
} from "../types"

// ─── Helpers ───────────────────────────────────────────────────
function mkPurchase(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    referenceNumber: "REF-DEFAULT",
    productCategory: null,
    quantity: 1,
    unitPrice: 0,
    extendedPrice: 0,
    purchaseDate: new Date("2026-02-01T00:00:00Z"),
    cptCode: null,
    caseId: null,
    ...overrides,
  }
}

function mkPeriod(purchases: PurchaseRecord[], overrides?: Partial<PeriodData>): PeriodData {
  return {
    purchases,
    totalSpend: purchases.reduce((a, p) => a + p.extendedPrice, 0),
    ...overrides,
  }
}

describe("calculateCarveOut — PERCENT_OF_SPEND", () => {
  it("single line, 3 purchases of $1000 for ref A @ 5% → $150 rebate", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        {
          referenceNumber: "A",
          rateType: "PERCENT_OF_SPEND",
          rebatePercent: 0.05,
        },
      ],
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", quantity: 1, unitPrice: 1000, extendedPrice: 1000 }),
      mkPurchase({ referenceNumber: "A", quantity: 1, unitPrice: 1000, extendedPrice: 1000 }),
      mkPurchase({ referenceNumber: "A", quantity: 1, unitPrice: 1000, extendedPrice: 1000 }),
    ]
    const result = calculateCarveOut(config, mkPeriod(purchases))

    expect(result.type).toBe("CARVE_OUT")
    expect(result.rebateEarned).toBeCloseTo(150, 10)
    expect(result.eligibleSpend).toBe(3000)
    expect(result.tierResult).toBeNull()
    expect(result.trueUpAdjustment).toBe(0)
    expect(result.priceReductionValue).toBe(0)
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.carveOutLines).toHaveLength(1)
    expect(result.carveOutLines?.[0]).toMatchObject({
      referenceNumber: "A",
      rateType: "PERCENT_OF_SPEND",
      totalSpend: 3000,
      totalUnits: 3,
    })
    expect(result.carveOutLines?.[0]?.lineRebate).toBeCloseTo(150, 10)
  })
})

describe("calculateCarveOut — FIXED_PER_UNIT", () => {
  it("single line, 10 units for ref B @ $5/unit → $50 rebate", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        {
          referenceNumber: "B",
          rateType: "FIXED_PER_UNIT",
          rebatePerUnit: 5,
        },
      ],
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "B", quantity: 4, unitPrice: 100, extendedPrice: 400 }),
      mkPurchase({ referenceNumber: "B", quantity: 6, unitPrice: 100, extendedPrice: 600 }),
    ]
    const result = calculateCarveOut(config, mkPeriod(purchases))

    expect(result.rebateEarned).toBe(50)
    expect(result.eligibleSpend).toBe(1000)
    expect(result.carveOutLines).toHaveLength(1)
    expect(result.carveOutLines?.[0]).toMatchObject({
      referenceNumber: "B",
      rateType: "FIXED_PER_UNIT",
      totalSpend: 1000,
      totalUnits: 10,
      lineRebate: 50,
    })
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
  })
})

describe("calculateCarveOut — mixed rate types", () => {
  it("three lines (2 PERCENT_OF_SPEND + 1 FIXED_PER_UNIT) sum correctly", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        // Line 1: 5% of $2,000 = $100
        { referenceNumber: "REF-1", rateType: "PERCENT_OF_SPEND", rebatePercent: 0.05 },
        // Line 2: 10% of $1,500 = $150
        { referenceNumber: "REF-2", rateType: "PERCENT_OF_SPEND", rebatePercent: 0.10 },
        // Line 3: $2.50 × 20 units = $50
        { referenceNumber: "REF-3", rateType: "FIXED_PER_UNIT", rebatePerUnit: 2.5 },
      ],
    }

    const purchases: PurchaseRecord[] = [
      // REF-1: $2,000 total spend, 2 units
      mkPurchase({ referenceNumber: "REF-1", quantity: 1, unitPrice: 1200, extendedPrice: 1200 }),
      mkPurchase({ referenceNumber: "REF-1", quantity: 1, unitPrice: 800, extendedPrice: 800 }),
      // REF-2: $1,500 total spend, 3 units
      mkPurchase({ referenceNumber: "REF-2", quantity: 3, unitPrice: 500, extendedPrice: 1500 }),
      // REF-3: 20 units
      mkPurchase({ referenceNumber: "REF-3", quantity: 20, unitPrice: 10, extendedPrice: 200 }),
      // Noise: unrelated ref that shouldn't contribute
      mkPurchase({ referenceNumber: "REF-OTHER", quantity: 5, unitPrice: 99, extendedPrice: 495 }),
    ]

    const result = calculateCarveOut(config, mkPeriod(purchases))

    expect(result.rebateEarned).toBeCloseTo(100 + 150 + 50, 10)
    // eligibleSpend = 2000 + 1500 + 200 = 3700 (excludes REF-OTHER)
    expect(result.eligibleSpend).toBe(3700)
    expect(result.carveOutLines).toHaveLength(3)

    const [l1, l2, l3] = result.carveOutLines ?? []
    expect(l1).toMatchObject({ referenceNumber: "REF-1", totalSpend: 2000, totalUnits: 2 })
    expect(l1?.lineRebate).toBeCloseTo(100, 10)
    expect(l2).toMatchObject({ referenceNumber: "REF-2", totalSpend: 1500, totalUnits: 3 })
    expect(l2?.lineRebate).toBeCloseTo(150, 10)
    expect(l3).toMatchObject({ referenceNumber: "REF-3", totalSpend: 200, totalUnits: 20 })
    expect(l3?.lineRebate).toBeCloseTo(50, 10)

    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
  })
})

describe("calculateCarveOut — missing rate field warnings", () => {
  it("PERCENT_OF_SPEND without rebatePercent → warning + zero line rebate", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        { referenceNumber: "A", rateType: "PERCENT_OF_SPEND" /* no rebatePercent */ },
      ],
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", quantity: 2, unitPrice: 500, extendedPrice: 1000 }),
    ]
    const result = calculateCarveOut(config, mkPeriod(purchases))

    expect(result.rebateEarned).toBe(0)
    expect(result.eligibleSpend).toBe(1000)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("rebatePercent required for PERCENT_OF_SPEND")
    expect(result.warnings[0]).toContain("A")
    expect(result.carveOutLines?.[0]?.lineRebate).toBe(0)
    expect(result.carveOutLines?.[0]?.warning).toContain("rebatePercent required")
  })

  it("FIXED_PER_UNIT without rebatePerUnit → warning + zero line rebate", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        { referenceNumber: "B", rateType: "FIXED_PER_UNIT" /* no rebatePerUnit */ },
      ],
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "B", quantity: 10, unitPrice: 100, extendedPrice: 1000 }),
    ]
    const result = calculateCarveOut(config, mkPeriod(purchases))

    expect(result.rebateEarned).toBe(0)
    expect(result.eligibleSpend).toBe(1000)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("rebatePerUnit required for FIXED_PER_UNIT")
    expect(result.warnings[0]).toContain("B")
    expect(result.carveOutLines?.[0]?.lineRebate).toBe(0)
    expect(result.carveOutLines?.[0]?.warning).toContain("rebatePerUnit required")
  })

  it("null rebatePercent treated as missing", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        { referenceNumber: "A", rateType: "PERCENT_OF_SPEND", rebatePercent: null },
      ],
    }
    const result = calculateCarveOut(config, mkPeriod([]))
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("rebatePercent required")
  })
})

describe("calculateCarveOut — no matching purchases", () => {
  it("line with no matching purchases → zero line, no warning", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        { referenceNumber: "NO-MATCH", rateType: "PERCENT_OF_SPEND", rebatePercent: 0.10 },
      ],
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "OTHER", quantity: 1, extendedPrice: 500 }),
    ]
    const result = calculateCarveOut(config, mkPeriod(purchases))

    expect(result.rebateEarned).toBe(0)
    expect(result.eligibleSpend).toBe(0)
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.carveOutLines).toHaveLength(1)
    expect(result.carveOutLines?.[0]).toMatchObject({
      referenceNumber: "NO-MATCH",
      totalSpend: 0,
      totalUnits: 0,
      lineRebate: 0,
    })
    expect(result.carveOutLines?.[0]?.warning).toBeUndefined()
  })
})

describe("calculateCarveOut — empty config", () => {
  it("empty lines → zero rebate, no warnings, no errors", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [],
    }
    const result = calculateCarveOut(config, mkPeriod([]))

    expect(result.type).toBe("CARVE_OUT")
    expect(result.rebateEarned).toBe(0)
    expect(result.eligibleSpend).toBe(0)
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.carveOutLines).toEqual([])
    expect(result.tierResult).toBeNull()
    expect(result.trueUpAdjustment).toBe(0)
  })

  it("echoes periodLabel from options", () => {
    const config: CarveOutConfig = { type: "CARVE_OUT", lines: [] }
    const result = calculateCarveOut(config, mkPeriod([]), { periodLabel: "2026-Q2" })
    expect(result.periodLabel).toBe("2026-Q2")
  })
})

describe("calculateCarveOut — eligibleSpend aggregation", () => {
  it("eligibleSpend equals sum of per-line totalSpends across all lines", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        { referenceNumber: "X", rateType: "PERCENT_OF_SPEND", rebatePercent: 0.02 },
        { referenceNumber: "Y", rateType: "FIXED_PER_UNIT", rebatePerUnit: 1 },
        { referenceNumber: "Z", rateType: "PERCENT_OF_SPEND", rebatePercent: 0.03 },
      ],
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "X", quantity: 1, unitPrice: 1234.56, extendedPrice: 1234.56 }),
      mkPurchase({ referenceNumber: "X", quantity: 2, unitPrice: 100, extendedPrice: 200 }),
      mkPurchase({ referenceNumber: "Y", quantity: 7, unitPrice: 50, extendedPrice: 350 }),
      mkPurchase({ referenceNumber: "Z", quantity: 1, unitPrice: 9999.99, extendedPrice: 9999.99 }),
      // Noise
      mkPurchase({ referenceNumber: "UNRELATED", quantity: 100, extendedPrice: 99999 }),
    ]
    const result = calculateCarveOut(config, mkPeriod(purchases))

    const lineSpends = (result.carveOutLines ?? []).map((l) => l.totalSpend)
    const sumOfLineSpends = lineSpends.reduce((a, b) => a + b, 0)
    expect(result.eligibleSpend).toBeCloseTo(sumOfLineSpends, 10)
    expect(result.eligibleSpend).toBeCloseTo(1234.56 + 200 + 350 + 9999.99, 10)
  })
})
