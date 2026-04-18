import { describe, it, expect } from "vitest"
import { calculateTierPriceReduction } from "../tier-price-reduction"
import type {
  PeriodData,
  PurchaseRecord,
  RebateTier,
  TierPriceReductionConfig,
} from "../types"

// ─── Fixtures ──────────────────────────────────────────────────
// Tier 1 (0-50k): no reduction. Tier 2 (50k-100k): reducedPrice=80.
// Tier 3 (100k+): priceReductionPercent=0.15.
const PRICE_REDUCTION_TIERS: RebateTier[] = [
  {
    tierNumber: 1,
    thresholdMin: 0,
    thresholdMax: 50_000,
    rebateValue: 0,
  },
  {
    tierNumber: 2,
    thresholdMin: 50_000,
    thresholdMax: 100_000,
    rebateValue: 0,
    reducedPrice: 80,
  },
  {
    tierNumber: 3,
    thresholdMin: 100_000,
    thresholdMax: null,
    rebateValue: 0,
    priceReductionPercent: 0.15,
  },
]

function mkPurchase(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    referenceNumber: "REF-DEFAULT",
    productCategory: null,
    quantity: 1,
    unitPrice: 100,
    extendedPrice: 100,
    purchaseDate: new Date("2026-01-15"),
    cptCode: null,
    caseId: null,
    ...overrides,
  }
}

describe("calculateTierPriceReduction — [A7] per-line (not aggregate) breakdown", () => {
  it("mixed-price purchases return PER-LINE results, not a single aggregate", () => {
    const purchases = [
      mkPurchase({
        referenceNumber: "REF-A",
        unitPrice: 100,
        quantity: 10,
        extendedPrice: 1000,
      }),
      mkPurchase({
        referenceNumber: "REF-B",
        unitPrice: 150,
        quantity: 10,
        extendedPrice: 1500,
      }),
      mkPurchase({
        referenceNumber: "REF-C",
        unitPrice: 200,
        quantity: 10,
        extendedPrice: 2000,
      }),
    ]
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: PRICE_REDUCTION_TIERS,
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    // Pad to qualify for tier 2 (50k threshold). 4500 of real purchases +
    // 55_500 padder row gets us over.
    purchases.push(
      mkPurchase({
        referenceNumber: "PADDER",
        unitPrice: 1,
        quantity: 55_500,
        extendedPrice: 55_500,
      }),
    )
    const periodData: PeriodData = {
      purchases,
      totalSpend: 60_000,
    }
    const result = calculateTierPriceReduction(config, periodData)

    // Tier 2 achieved — reducedPrice = 80.
    expect(result.tierResult?.tier.tierNumber).toBe(2)

    // Per-line, one entry per purchase in the filter set.
    expect(result.priceReductionLines).toHaveLength(4)
    const byRef = new Map(
      (result.priceReductionLines ?? []).map((l) => [l.referenceNumber, l]),
    )

    // REF-A: original 100, effective 80, reduction per unit 20 × 10 = 200
    expect(byRef.get("REF-A")).toMatchObject({
      originalUnitPrice: 100,
      effectiveUnitPrice: 80,
      totalLineReduction: 200,
    })
    // REF-B: original 150 → effective 80, reduction 70 × 10 = 700
    expect(byRef.get("REF-B")).toMatchObject({
      originalUnitPrice: 150,
      effectiveUnitPrice: 80,
      totalLineReduction: 700,
    })
    // REF-C: original 200 → effective 80, reduction 120 × 10 = 1200
    expect(byRef.get("REF-C")).toMatchObject({
      originalUnitPrice: 200,
      effectiveUnitPrice: 80,
      totalLineReduction: 1200,
    })
  })

  it("priceReductionValue equals sum of line.totalLineReduction", () => {
    const purchases = [
      mkPurchase({ unitPrice: 100, quantity: 10, extendedPrice: 1000 }),
      mkPurchase({ unitPrice: 150, quantity: 10, extendedPrice: 1500 }),
      mkPurchase({
        referenceNumber: "PAD",
        unitPrice: 1,
        quantity: 60_000,
        extendedPrice: 60_000,
      }),
    ]
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: PRICE_REDUCTION_TIERS,
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = { purchases, totalSpend: 62_500 }
    const result = calculateTierPriceReduction(config, periodData)

    const lineSum = (result.priceReductionLines ?? []).reduce(
      (acc, l) => acc + l.totalLineReduction,
      0,
    )
    expect(result.priceReductionValue).toBe(lineSum)
  })

  it("FORWARD_ONLY trigger emits a warning", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: PRICE_REDUCTION_TIERS,
      spendBasis: "ALL_SPEND",
      trigger: "FORWARD_ONLY",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ unitPrice: 100, quantity: 10, extendedPrice: 1000 }),
        mkPurchase({
          referenceNumber: "PAD",
          unitPrice: 1,
          quantity: 60_000,
          extendedPrice: 60_000,
        }),
      ],
      totalSpend: 61_000,
    }
    const result = calculateTierPriceReduction(config, periodData)
    expect(
      result.warnings.some((w) => w.includes("FORWARD_ONLY")),
    ).toBe(true)
  })

  it("rebateEarned === 0 even when a reduction is applied", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: PRICE_REDUCTION_TIERS,
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    // All purchases at unitPrice 100 → reducedPrice=80 produces a clean
    // positive reduction. Padder row at 100 unit-price triggers tier 2.
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ unitPrice: 100, quantity: 10, extendedPrice: 1000 }),
        mkPurchase({
          referenceNumber: "PAD",
          unitPrice: 100,
          quantity: 600,
          extendedPrice: 60_000,
        }),
      ],
      totalSpend: 61_000,
    }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.priceReductionValue).toBeGreaterThan(0)
    expect(result.rebateEarned).toBe(0)
  })
})

describe("calculateTierPriceReduction — spendBasis filtering", () => {
  it("REFERENCE_NUMBER basis: only matching refs feed both eligibleSpend and lines", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: PRICE_REDUCTION_TIERS,
      spendBasis: "REFERENCE_NUMBER",
      trigger: "RETROACTIVE",
      referenceNumbers: ["REF-A"],
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({
          referenceNumber: "REF-A",
          unitPrice: 100,
          quantity: 600,
          extendedPrice: 60_000,
        }),
        mkPurchase({
          referenceNumber: "REF-B",
          unitPrice: 200,
          quantity: 500,
          extendedPrice: 100_000,
        }),
      ],
      totalSpend: 160_000,
    }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.eligibleSpend).toBe(60_000)
    expect(result.tierResult?.tier.tierNumber).toBe(2)
    // Only REF-A contributes lines.
    expect(result.priceReductionLines).toHaveLength(1)
    expect(result.priceReductionLines?.[0]?.referenceNumber).toBe("REF-A")
  })

  it("PRODUCT_CATEGORY basis filters by exact productCategory match", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: PRICE_REDUCTION_TIERS,
      spendBasis: "PRODUCT_CATEGORY",
      trigger: "RETROACTIVE",
      productCategory: "ORTHO",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({
          productCategory: "ORTHO",
          unitPrice: 100,
          quantity: 600,
          extendedPrice: 60_000,
        }),
        mkPurchase({
          productCategory: "CARDIO",
          unitPrice: 100,
          quantity: 600,
          extendedPrice: 60_000,
        }),
      ],
      totalSpend: 120_000,
    }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.eligibleSpend).toBe(60_000)
    expect(result.priceReductionLines).toHaveLength(1)
    expect(result.priceReductionLines?.[0]?.originalUnitPrice).toBe(100)
  })

  it("MULTI_CATEGORY basis sums across listed categories", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: PRICE_REDUCTION_TIERS,
      spendBasis: "MULTI_CATEGORY",
      trigger: "RETROACTIVE",
      categories: ["ORTHO", "CARDIO"],
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({
          productCategory: "ORTHO",
          unitPrice: 100,
          quantity: 300,
          extendedPrice: 30_000,
        }),
        mkPurchase({
          productCategory: "CARDIO",
          unitPrice: 100,
          quantity: 400,
          extendedPrice: 40_000,
        }),
        mkPurchase({
          productCategory: "GI",
          unitPrice: 100,
          quantity: 999,
          extendedPrice: 99_900,
        }),
      ],
      totalSpend: 169_900,
    }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.eligibleSpend).toBe(70_000)
    expect(result.priceReductionLines).toHaveLength(2)
  })

  it("ALL_SPEND basis sums every purchase into eligibleSpend", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: PRICE_REDUCTION_TIERS,
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ unitPrice: 100, quantity: 10, extendedPrice: 1000 }),
        mkPurchase({
          referenceNumber: "PAD",
          unitPrice: 1,
          quantity: 55_000,
          extendedPrice: 55_000,
        }),
      ],
      totalSpend: 56_000,
    }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.eligibleSpend).toBe(56_000)
    expect(result.priceReductionLines).toHaveLength(2)
  })
})

describe("calculateTierPriceReduction — edge cases", () => {
  it("no tier matched → zero result, no tier-config warnings", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "INCLUSIVE",
      // Bump lowest tier above 0 so spend of 1_000 doesn't qualify.
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 10_000,
          thresholdMax: null,
          rebateValue: 0,
          reducedPrice: 50,
        },
      ],
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ unitPrice: 100, quantity: 10, extendedPrice: 1000 }),
      ],
      totalSpend: 1_000,
    }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.priceReductionValue).toBe(0)
    expect(result.priceReductionLines).toEqual([])
    expect(result.tierResult).toBeNull()
    expect(result.rebateEarned).toBe(0)
    // No "missing reducedPrice/priceReductionPercent" warning — we never
    // reached that code path because the tier wasn't matched.
    expect(
      result.warnings.some((w) => w.includes("Tier is missing")),
    ).toBe(false)
  })

  it("tier missing both reducedPrice and priceReductionPercent → warning + zero reduction", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 0,
          thresholdMax: null,
          rebateValue: 0,
        },
      ],
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ unitPrice: 100, quantity: 5, extendedPrice: 500 }),
      ],
      totalSpend: 500,
    }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.priceReductionValue).toBe(0)
    expect(
      result.warnings.some((w) =>
        w.includes("missing both reducedPrice and priceReductionPercent"),
      ),
    ).toBe(true)
  })

  it("empty tiers → warning and zero reduction (no throw)", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = { purchases: [], totalSpend: 0 }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.rebateEarned).toBe(0)
    expect(result.priceReductionValue).toBe(0)
    expect(
      result.warnings.some((w) => w.includes("no tiers configured")),
    ).toBe(true)
  })

  it("rebateEarned === 0 when no tier matches", () => {
    const config: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "INCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 1_000_000,
          thresholdMax: null,
          rebateValue: 0,
          reducedPrice: 10,
        },
      ],
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    const periodData: PeriodData = { purchases: [], totalSpend: 100 }
    const result = calculateTierPriceReduction(config, periodData)
    expect(result.rebateEarned).toBe(0)
  })
})
