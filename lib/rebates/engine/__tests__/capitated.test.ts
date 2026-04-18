import { describe, it, expect } from "vitest"
import { calculateCapitated } from "../capitated"
import type {
  CapitatedConfig,
  PeriodData,
  PurchaseRecord,
  SpendRebateConfig,
  TierPriceReductionConfig,
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

function mkPeriod(
  purchases: PurchaseRecord[],
  overrides?: Partial<PeriodData>,
): PeriodData {
  return {
    purchases,
    totalSpend: purchases.reduce((a, p) => a + p.extendedPrice, 0),
    ...overrides,
  }
}

describe("calculateCapitated — cap math without embedded rebate", () => {
  it("group spend $100K / cap $80K → eligibleSpend $80K, capExceededBy warning emitted", () => {
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: ["A", "B"],
      periodCap: 80_000,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", extendedPrice: 60_000 }),
      mkPurchase({ referenceNumber: "B", extendedPrice: 40_000 }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))

    expect(result.type).toBe("CAPITATED")
    expect(result.eligibleSpend).toBe(80_000)
    expect(result.rebateEarned).toBe(0)
    expect(result.priceReductionValue).toBe(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("exceeded period cap")
    expect(result.warnings[0]).toContain("$100000")
    expect(result.warnings[0]).toContain("$80000")
    expect(result.warnings[0]).toContain("$20000")
    expect(result.errors).toEqual([])
    expect(result.tierResult).toBeNull()
  })

  it("group spend $50K / cap $80K → eligibleSpend $50K, no warning", () => {
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: ["A", "B"],
      periodCap: 80_000,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", extendedPrice: 30_000 }),
      mkPurchase({ referenceNumber: "B", extendedPrice: 20_000 }),
      // Out-of-group purchase should be excluded from groupSpend.
      mkPurchase({ referenceNumber: "OTHER", extendedPrice: 999_999 }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))

    expect(result.eligibleSpend).toBe(50_000)
    expect(result.rebateEarned).toBe(0)
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
  })

  it("no embedded rebate → rebateEarned = 0, priceReductionValue = 0", () => {
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: ["A"],
      periodCap: 100_000,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", extendedPrice: 25_000 }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))
    expect(result.rebateEarned).toBe(0)
    expect(result.priceReductionValue).toBe(0)
    expect(result.eligibleSpend).toBe(25_000)
    expect(result.tierResult).toBeNull()
  })

  it("empty groupedReferenceNumbers → groupSpend 0, eligibleSpend 0, no warnings", () => {
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: [],
      periodCap: 80_000,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", extendedPrice: 99_000 }),
      mkPurchase({ referenceNumber: "B", extendedPrice: 50_000 }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))

    expect(result.eligibleSpend).toBe(0)
    expect(result.rebateEarned).toBe(0)
    expect(result.warnings).toEqual([])
    expect(result.errors).toEqual([])
  })

  it("echoes periodLabel from options", () => {
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: [],
      periodCap: 0,
    }
    const result = calculateCapitated(config, mkPeriod([]), {
      periodLabel: "2026-Q3",
    })
    expect(result.periodLabel).toBe("2026-Q3")
  })
})

describe("calculateCapitated — embedded SpendRebateConfig", () => {
  it("cap $80K, group spend $100K, embedded 3% flat rebate → $2400 rebate (on capped $80K)", () => {
    const embedded: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 0,
          thresholdMax: null,
          rebateValue: 3, // 3%
        },
      ],
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: ["A", "B"],
      periodCap: 80_000,
      embeddedRebate: embedded,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", extendedPrice: 70_000 }),
      mkPurchase({ referenceNumber: "B", extendedPrice: 30_000 }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))

    expect(result.type).toBe("CAPITATED")
    expect(result.eligibleSpend).toBe(80_000)
    expect(result.rebateEarned).toBeCloseTo(2_400, 6)
    expect(result.priceReductionValue).toBe(0)
    expect(result.tierResult?.tier.tierNumber).toBe(1)
    // Cap overage warning present.
    expect(result.warnings.some((w) => w.includes("exceeded period cap"))).toBe(
      true,
    )
    expect(result.errors).toEqual([])
  })

  it("[A8] embedded config with REFERENCE_NUMBER basis is normalized to ALL_SPEND — no double-filter", () => {
    // If the sub-engine were to re-filter on referenceNumbers = ["Z"], it
    // would return 0. The normalization forces ALL_SPEND so it computes
    // on the full $50K filtered slice → 10% × $50K = $5,000.
    const embedded: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 0,
          thresholdMax: null,
          rebateValue: 10,
        },
      ],
      // These filters would eliminate every in-group purchase if the
      // sub-engine honored them. The capitated engine must strip them.
      spendBasis: "REFERENCE_NUMBER",
      referenceNumbers: ["Z-NOT-IN-GROUP"],
      baselineType: "NONE",
    }
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: ["A", "B"],
      periodCap: 100_000,
      embeddedRebate: embedded,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", extendedPrice: 30_000 }),
      mkPurchase({ referenceNumber: "B", extendedPrice: 20_000 }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))

    expect(result.eligibleSpend).toBe(50_000)
    expect(result.rebateEarned).toBeCloseTo(5_000, 6)
    expect(result.errors).toEqual([])
  })

  it("sub-engine warnings are propagated with 'Embedded: ' prefix", () => {
    const embedded: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: ["A"],
      periodCap: 50_000,
      embeddedRebate: embedded,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({ referenceNumber: "A", extendedPrice: 10_000 }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))

    // The sub-engine emits "no tiers configured" warning when tiers is empty.
    expect(
      result.warnings.some(
        (w) => w.startsWith("Embedded: ") && w.includes("no tiers configured"),
      ),
    ).toBe(true)
  })
})

describe("calculateCapitated — embedded TierPriceReductionConfig", () => {
  it("embedded tier price reduction applies to filtered purchases; priceReductionLines populated", () => {
    const embedded: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 0,
          thresholdMax: null,
          rebateValue: 0,
          reducedPrice: 80, // cut unit price to $80
        },
      ],
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: ["A"],
      periodCap: 100_000,
      embeddedRebate: embedded,
    }
    // 2 purchases @ 100 unit price × 10 units = $1000 each → $2000 total,
    // reducedPrice = $80 → reduction of $20/unit × 20 units = $400.
    const purchases: PurchaseRecord[] = [
      mkPurchase({
        referenceNumber: "A",
        quantity: 10,
        unitPrice: 100,
        extendedPrice: 1_000,
      }),
      mkPurchase({
        referenceNumber: "A",
        quantity: 10,
        unitPrice: 100,
        extendedPrice: 1_000,
      }),
      // Out-of-group noise should not appear in priceReductionLines.
      mkPurchase({
        referenceNumber: "NOT-IN-GROUP",
        quantity: 5,
        unitPrice: 999,
        extendedPrice: 4_995,
      }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))

    expect(result.type).toBe("CAPITATED")
    expect(result.eligibleSpend).toBe(2_000)
    expect(result.rebateEarned).toBe(0)
    expect(result.priceReductionValue).toBeCloseTo(400, 6)
    expect(result.priceReductionLines).toBeDefined()
    expect(result.priceReductionLines).toHaveLength(2)
    for (const line of result.priceReductionLines ?? []) {
      expect(line.referenceNumber).toBe("A")
      expect(line.originalUnitPrice).toBe(100)
      expect(line.effectiveUnitPrice).toBe(80)
    }
    expect(result.errors).toEqual([])
  })

  it("[A8] embedded price-reduction config with PRODUCT_CATEGORY basis is normalized to ALL_SPEND", () => {
    const embedded: TierPriceReductionConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 0,
          thresholdMax: null,
          rebateValue: 0,
          priceReductionPercent: 0.1, // 10% off
        },
      ],
      // This filter would exclude every in-group purchase if honored.
      spendBasis: "PRODUCT_CATEGORY",
      productCategory: "DOES_NOT_EXIST",
      trigger: "RETROACTIVE",
    }
    const config: CapitatedConfig = {
      type: "CAPITATED",
      groupedReferenceNumbers: ["A"],
      periodCap: 100_000,
      embeddedRebate: embedded,
    }
    const purchases: PurchaseRecord[] = [
      mkPurchase({
        referenceNumber: "A",
        productCategory: "WIDGETS",
        quantity: 5,
        unitPrice: 100,
        extendedPrice: 500,
      }),
    ]
    const result = calculateCapitated(config, mkPeriod(purchases))

    expect(result.eligibleSpend).toBe(500)
    // 10% of $500 = $50 reduction.
    expect(result.priceReductionValue).toBeCloseTo(50, 6)
    expect(result.priceReductionLines).toHaveLength(1)
    expect(result.errors).toEqual([])
  })
})
