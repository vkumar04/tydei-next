import { describe, it, expect } from "vitest"
import {
  buildOverviewCard,
  buildRebateTermsCard,
  buildFinancialCard,
  buildPricingItemsCard,
  buildContractTermsCard,
  type ContractForCompare,
} from "../compare-cards"

function baseContract(
  overrides: Partial<ContractForCompare> = {},
): ContractForCompare {
  return {
    id: "c1",
    name: "Test Contract",
    vendor: { id: "v1", name: "Acme Med" },
    contractType: "TIERED_REBATE",
    status: "ACTIVE",
    effectiveDate: new Date("2024-01-01T00:00:00Z"),
    expirationDate: new Date("2025-01-01T00:00:00Z"),
    totalValue: 1_000_000,
    facilities: [
      { id: "f1", name: "Main" },
      { id: "f2", name: "North" },
    ],
    terms: [
      {
        id: "t1",
        termName: "Volume Rebate",
        termType: "PERCENT_OF_SPEND",
        tiers: [
          {
            tierNumber: 1,
            tierName: null,
            spendMin: 0,
            spendMax: 50_000,
            rebateValue: 2,
          },
          {
            tierNumber: 2,
            tierName: "Gold",
            spendMin: 50_000,
            spendMax: null,
            rebateValue: 4,
          },
        ],
      },
    ],
    pricingItems: [
      {
        vendorItemNo: "A1",
        description: "Gauze",
        category: "Wound Care",
        unitPrice: 10,
      },
      {
        vendorItemNo: "A2",
        description: "Bandage",
        category: "Wound Care",
        unitPrice: 20,
      },
      {
        vendorItemNo: "B1",
        description: "Syringe",
        category: "Injection",
        unitPrice: 5,
      },
    ],
    metrics: {
      spend: 500_000,
      rebate: 20_000,
      rebateCollected: 15_000,
    },
    score: 87.4,
    ...overrides,
  }
}

describe("buildOverviewCard", () => {
  it("emits 9 rows in the documented order", () => {
    const card = buildOverviewCard(baseContract())
    expect(card.rows).toHaveLength(9)
    expect(card.rows.map((r) => r.label)).toEqual([
      "Vendor",
      "Type",
      "Status",
      "Effective",
      "Expiration",
      "Total Value",
      "Rebates Earned",
      "Score",
      "Facility Count",
    ])
  })

  it("formats currency rows and facility count", () => {
    const card = buildOverviewCard(baseContract())
    const byLabel = Object.fromEntries(card.rows.map((r) => [r.label, r.value]))
    expect(byLabel["Vendor"]).toBe("Acme Med")
    expect(byLabel["Total Value"]).toBe("$1,000,000")
    expect(byLabel["Rebates Earned"]).toBe("$20,000")
    expect(byLabel["Facility Count"]).toBe("2")
    expect(byLabel["Score"]).toBe("87")
  })

  it("shows em-dash for null score and $0 when metrics absent", () => {
    const card = buildOverviewCard(
      baseContract({ score: null, metrics: undefined }),
    )
    const byLabel = Object.fromEntries(card.rows.map((r) => [r.label, r.value]))
    expect(byLabel["Score"]).toBe("—")
    expect(byLabel["Rebates Earned"]).toBe("$0")
  })
})

describe("buildRebateTermsCard", () => {
  it("returns isEmpty=true and empty array when contract has no terms", () => {
    const card = buildRebateTermsCard(baseContract({ terms: [] }))
    expect(card.isEmpty).toBe(true)
    expect(card.terms).toEqual([])
  })

  it("labels tiers by name when present, falls back to Tier N", () => {
    const card = buildRebateTermsCard(baseContract())
    expect(card.isEmpty).toBe(false)
    expect(card.terms).toHaveLength(1)
    const labels = card.terms[0].tiers.map((t) => t.label)
    expect(labels).toEqual(["Tier 1", "Gold"])
  })

  it("formats threshold dollar for capped and uncapped tiers", () => {
    const card = buildRebateTermsCard(baseContract())
    const thresholds = card.terms[0].tiers.map((t) => t.thresholdDollar)
    expect(thresholds[0]).toBe("$0–$50,000")
    expect(thresholds[1]).toBe("$50,000+")
  })

  it("renders percent rate labels for PERCENT term types", () => {
    const card = buildRebateTermsCard(baseContract())
    const rates = card.terms[0].tiers.map((t) => t.rateLabel)
    expect(rates[0]).toContain("2%")
    expect(rates[1]).toContain("4%")
    expect(rates[1]).toContain("$50,000")
  })
})

describe("buildFinancialCard", () => {
  it("computes outstanding and effective rebate rate", () => {
    const card = buildFinancialCard(baseContract())
    expect(card.totalSpend).toBe(500_000)
    expect(card.rebatesEarned).toBe(20_000)
    expect(card.rebatesCollected).toBe(15_000)
    expect(card.outstanding).toBe(5_000)
    // 20_000 / 500_000 * 100 = 4
    expect(card.effectiveRebateRate).toBeCloseTo(4, 5)
    expect(card.color).toBe("green")
  })

  it("assigns amber for rates in [1.5, 3) and red below 1.5", () => {
    const amber = buildFinancialCard(
      baseContract({ metrics: { spend: 1_000_000, rebate: 20_000, rebateCollected: 0 } }),
    )
    expect(amber.effectiveRebateRate).toBeCloseTo(2, 5)
    expect(amber.color).toBe("amber")

    const red = buildFinancialCard(
      baseContract({ metrics: { spend: 1_000_000, rebate: 5_000, rebateCollected: 0 } }),
    )
    expect(red.color).toBe("red")
  })

  it("returns rate=0 and red when spend is zero (safe divide)", () => {
    const card = buildFinancialCard(
      baseContract({ metrics: { spend: 0, rebate: 0, rebateCollected: 0 } }),
    )
    expect(card.effectiveRebateRate).toBe(0)
    expect(card.color).toBe("red")
    expect(card.outstanding).toBe(0)
  })
})

describe("buildPricingItemsCard", () => {
  it("counts items, unique categories and averages unit price", () => {
    const card = buildPricingItemsCard(baseContract())
    expect(card.itemCount).toBe(3)
    expect(card.categoriesCount).toBe(2)
    expect(card.avgUnitPrice).toBeCloseTo((10 + 20 + 5) / 3, 5)
    expect(card.topCategories).toEqual(["Wound Care", "Injection"])
    expect(card.remainingCount).toBe(0)
  })

  it("surfaces top 3 categories by count with remainingCount for extras", () => {
    const contract = baseContract({
      pricingItems: [
        { vendorItemNo: "1", description: null, category: "A", unitPrice: 1 },
        { vendorItemNo: "2", description: null, category: "A", unitPrice: 1 },
        { vendorItemNo: "3", description: null, category: "A", unitPrice: 1 },
        { vendorItemNo: "4", description: null, category: "B", unitPrice: 1 },
        { vendorItemNo: "5", description: null, category: "B", unitPrice: 1 },
        { vendorItemNo: "6", description: null, category: "C", unitPrice: 1 },
        { vendorItemNo: "7", description: null, category: "D", unitPrice: 1 },
        { vendorItemNo: "8", description: null, category: "E", unitPrice: 1 },
      ],
    })
    const card = buildPricingItemsCard(contract)
    expect(card.categoriesCount).toBe(5)
    expect(card.topCategories).toEqual(["A", "B", "C"])
    expect(card.remainingCount).toBe(2)
  })

  it("treats null/blank categories as Uncategorized and handles empty list", () => {
    const empty = buildPricingItemsCard(baseContract({ pricingItems: [] }))
    expect(empty.itemCount).toBe(0)
    expect(empty.categoriesCount).toBe(0)
    expect(empty.avgUnitPrice).toBe(0)
    expect(empty.topCategories).toEqual([])
    expect(empty.remainingCount).toBe(0)

    const nullCat = buildPricingItemsCard(
      baseContract({
        pricingItems: [
          { vendorItemNo: "x", description: null, category: null, unitPrice: 4 },
          { vendorItemNo: "y", description: null, category: "  ", unitPrice: 6 },
        ],
      }),
    )
    expect(nullCat.categoriesCount).toBe(1)
    expect(nullCat.topCategories).toEqual(["Uncategorized"])
  })
})

describe("buildContractTermsCard", () => {
  it("computes duration, days remaining, color and scope for a mid-term contract", () => {
    const card = buildContractTermsCard(baseContract(), {
      referenceDate: new Date("2024-07-01T00:00:00Z"),
    })
    expect(card.durationMonths).toBe(12)
    // 2024-07-01 -> 2025-01-01 = 184 days
    expect(card.daysRemaining).toBe(184)
    expect(card.daysRemainingColor).toBe("green")
    expect(card.expiringSoon).toBe(false)
    expect(card.scope).toBe("multi_facility")
    expect(card.autoRenewal).toBe(false)
  })

  it("flags expiringSoon and amber within 90 days", () => {
    const card = buildContractTermsCard(baseContract(), {
      referenceDate: new Date("2024-10-15T00:00:00Z"),
    })
    // ~78 days to 2025-01-01
    expect(card.daysRemaining).toBeGreaterThan(0)
    expect(card.daysRemaining).toBeLessThan(90)
    expect(card.daysRemainingColor).toBe("amber")
    expect(card.expiringSoon).toBe(true)
  })

  it("returns negative daysRemaining and red when expired", () => {
    const card = buildContractTermsCard(baseContract(), {
      referenceDate: new Date("2025-06-01T00:00:00Z"),
    })
    expect(card.daysRemaining).toBeLessThan(0)
    expect(card.daysRemainingColor).toBe("red")
    expect(card.expiringSoon).toBe(false)
  })

  it("scope=facility for 1 facility, group for >5", () => {
    const single = buildContractTermsCard(
      baseContract({ facilities: [{ id: "f1", name: "Main" }] }),
      { referenceDate: new Date("2024-07-01T00:00:00Z") },
    )
    expect(single.scope).toBe("facility")

    const many = buildContractTermsCard(
      baseContract({
        facilities: Array.from({ length: 6 }, (_, i) => ({
          id: `f${i}`,
          name: `F${i}`,
        })),
      }),
      { referenceDate: new Date("2024-07-01T00:00:00Z") },
    )
    expect(many.scope).toBe("group")
  })
})
