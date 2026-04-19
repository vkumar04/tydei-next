import { describe, it, expect } from "vitest"
import {
  buildConfigFromPrismaTerm,
  computeRebateFromPrismaTerm,
} from "../from-prisma"
import type { ContractTerm, ContractTier } from "@prisma/client"

/** Minimal Prisma fixture builder — nullable/default fields set to
 * their engine-equivalent defaults. */
function makeTerm(
  overrides: Partial<ContractTerm & { tiers: ContractTier[] }> = {},
): ContractTerm & { tiers: ContractTier[] } {
  const base = {
    id: "t-1",
    contractId: "c-1",
    termName: "Test",
    termType: "spend_rebate",
    baselineType: "spend_based",
    evaluationPeriod: "annual",
    paymentTiming: "quarterly",
    appliesTo: "all_products",
    rebateMethod: "cumulative",
    effectiveStart: new Date("2026-01-01"),
    effectiveEnd: new Date("2026-12-31"),
    volumeType: null,
    spendBaseline: null,
    volumeBaseline: null,
    growthBaselinePercent: null,
    desiredMarketShare: null,
    boundaryRule: null,
    priceReductionTrigger: null,
    shortfallHandling: null,
    negotiatedBaseline: null,
    growthOnly: false,
    periodCap: null,
    fixedRebatePerOccurrence: null,
    capitalCost: null,
    interestRate: null,
    termMonths: null,
    downPayment: null,
    paymentCadence: "monthly",
    minimumPurchaseCommitment: null,
    cptCodes: [],
    groupedReferenceNumbers: [],
    referenceNumbers: [],
    categories: [],
    marketShareVendorId: null,
    marketShareCategory: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    tiers: [],
    ...overrides,
  } as ContractTerm & { tiers: ContractTier[] }
  return base
}

/**
 * Override shape — accepts plain numbers for Decimal-typed fields;
 * we cast back to Decimal when building the row.
 */
type TierOverrides = Omit<
  Partial<ContractTier>,
  "spendMin" | "spendMax" | "rebateValue" | "marketShareMin" | "marketShareMax" | "fixedRebateAmount" | "reducedPrice" | "priceReductionPercent"
> & {
  spendMin?: number | null
  spendMax?: number | null
  rebateValue?: number | null
  marketShareMin?: number | null
  marketShareMax?: number | null
  fixedRebateAmount?: number | null
  reducedPrice?: number | null
  priceReductionPercent?: number | null
}

function makeTier(overrides: TierOverrides = {}): ContractTier {
  const asDecimal = <T>(v: number | null | undefined, fallback: number | null): T =>
    (v === undefined ? fallback : v) as unknown as T

  return {
    id: `tier-${overrides.tierNumber ?? 1}`,
    termId: "t-1",
    tierNumber: overrides.tierNumber ?? 1,
    tierName: overrides.tierName ?? null,
    spendMin: asDecimal(overrides.spendMin, 0),
    spendMax: asDecimal(overrides.spendMax, null),
    volumeMin: overrides.volumeMin ?? null,
    volumeMax: overrides.volumeMax ?? null,
    marketShareMin: asDecimal(overrides.marketShareMin, null),
    marketShareMax: asDecimal(overrides.marketShareMax, null),
    rebateType: overrides.rebateType ?? "percent_of_spend",
    rebateValue: asDecimal(overrides.rebateValue, 2),
    fixedRebateAmount: asDecimal(overrides.fixedRebateAmount, null),
    reducedPrice: asDecimal(overrides.reducedPrice, null),
    priceReductionPercent: asDecimal(overrides.priceReductionPercent, null),
    createdAt: overrides.createdAt ?? new Date(),
  }
}

describe("buildConfigFromPrismaTerm — spend_rebate", () => {
  it("maps a basic spend_rebate term with tiers to SpendRebateConfig", () => {
    const term = makeTerm({
      termType: "spend_rebate",
      rebateMethod: "cumulative",
      tiers: [
        makeTier({ tierNumber: 1, spendMin: 0, spendMax: 50_000, rebateValue: 2 }),
        makeTier({ tierNumber: 2, spendMin: 50_000, spendMax: null, rebateValue: 4 }),
      ],
    })
    const config = buildConfigFromPrismaTerm(term)
    expect(config.type).toBe("SPEND_REBATE")
    if (config.type === "SPEND_REBATE") {
      expect(config.method).toBe("CUMULATIVE")
      expect(config.boundaryRule).toBe("EXCLUSIVE")
      expect(config.spendBasis).toBe("ALL_SPEND")
      expect(config.baselineType).toBe("NONE")
      expect(config.tiers).toHaveLength(2)
      expect(config.tiers[0].thresholdMin).toBe(0)
      expect(config.tiers[1].rebateValue).toBe(4)
    }
  })

  it("defaults boundaryRule to EXCLUSIVE when null", () => {
    const term = makeTerm({
      tiers: [makeTier()],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.boundaryRule).toBe("EXCLUSIVE")
    }
  })

  it("maps INCLUSIVE boundary", () => {
    const term = makeTerm({
      boundaryRule: "inclusive",
      tiers: [makeTier()],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.boundaryRule).toBe("INCLUSIVE")
    }
  })

  it("maps marginal method", () => {
    const term = makeTerm({
      rebateMethod: "marginal",
      tiers: [makeTier()],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.method).toBe("MARGINAL")
    }
  })

  it("picks REFERENCE_NUMBER basis when referenceNumbers set", () => {
    const term = makeTerm({
      referenceNumbers: ["REF-1", "REF-2"],
      tiers: [makeTier()],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.spendBasis).toBe("REFERENCE_NUMBER")
      expect(config.referenceNumbers).toEqual(["REF-1", "REF-2"])
    }
  })

  it("picks PRODUCT_CATEGORY basis when exactly one category", () => {
    const term = makeTerm({
      categories: ["Orthopedics"],
      tiers: [makeTier()],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.spendBasis).toBe("PRODUCT_CATEGORY")
      expect(config.productCategory).toBe("Orthopedics")
    }
  })

  it("picks MULTI_CATEGORY basis when multiple categories", () => {
    const term = makeTerm({
      categories: ["Orthopedics", "Spine"],
      tiers: [makeTier()],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.spendBasis).toBe("MULTI_CATEGORY")
      expect(config.categories).toEqual(["Orthopedics", "Spine"])
    }
  })

  it("maps growth-only to PRIOR_YEAR_ACTUAL by default", () => {
    const term = makeTerm({
      growthOnly: true,
      tiers: [makeTier()],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.baselineType).toBe("PRIOR_YEAR_ACTUAL")
      expect(config.growthOnly).toBe(true)
    }
  })

  it("maps growth-only + negotiatedBaseline to NEGOTIATED_FIXED", () => {
    const term = makeTerm({
      growthOnly: true,
      negotiatedBaseline: 50_000 as unknown as ContractTerm["negotiatedBaseline"],
      tiers: [makeTier()],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.baselineType).toBe("NEGOTIATED_FIXED")
      expect(config.negotiatedBaseline).toBe(50_000)
    }
  })
})

describe("buildConfigFromPrismaTerm — volume_rebate", () => {
  it("maps a volume_rebate term to VolumeRebateConfig", () => {
    const term = makeTerm({
      termType: "volume_rebate",
      cptCodes: ["29881", "27447"],
      fixedRebatePerOccurrence: 100 as unknown as ContractTerm["fixedRebatePerOccurrence"],
      tiers: [makeTier({ tierNumber: 1, spendMin: 0, rebateValue: 1 })],
    })
    const config = buildConfigFromPrismaTerm(term)
    expect(config.type).toBe("VOLUME_REBATE")
    if (config.type === "VOLUME_REBATE") {
      expect(config.cptCodes).toEqual(["29881", "27447"])
      expect(config.fixedRebatePerOccurrence).toBe(100)
      expect(config.tiers).toHaveLength(1)
    }
  })
})

describe("buildConfigFromPrismaTerm — tier sort order", () => {
  it("sorts tiers by tierNumber ascending regardless of input order", () => {
    const term = makeTerm({
      tiers: [
        makeTier({ tierNumber: 3, spendMin: 100_000, rebateValue: 6 }),
        makeTier({ tierNumber: 1, spendMin: 0, rebateValue: 2 }),
        makeTier({ tierNumber: 2, spendMin: 50_000, rebateValue: 4 }),
      ],
    })
    const config = buildConfigFromPrismaTerm(term)
    if (config.type === "SPEND_REBATE") {
      expect(config.tiers.map((t) => t.tierNumber)).toEqual([1, 2, 3])
    } else {
      throw new Error("Expected SPEND_REBATE config")
    }
  })
})

describe("computeRebateFromPrismaTerm", () => {
  it("end-to-end — computes a cumulative spend rebate via the unified engine", () => {
    const term = makeTerm({
      termType: "spend_rebate",
      rebateMethod: "cumulative",
      tiers: [
        makeTier({ tierNumber: 1, spendMin: 0, spendMax: 50_000, rebateValue: 2 }),
        makeTier({ tierNumber: 2, spendMin: 50_000, spendMax: null, rebateValue: 4 }),
      ],
    })
    const result = computeRebateFromPrismaTerm(term, {
      purchases: [],
      totalSpend: 75_000,
    })
    expect(result.type).toBe("SPEND_REBATE")
    expect(result.errors).toEqual([])
    // $75K at tier 2 (4%) cumulative → $3,000
    expect(result.rebateEarned).toBe(3_000)
  })

  it("passes through periodLabel", () => {
    const term = makeTerm({ tiers: [makeTier()] })
    const result = computeRebateFromPrismaTerm(
      term,
      { purchases: [], totalSpend: 0 },
      { periodLabel: "2026-Q1" },
    )
    expect(result.periodLabel).toBe("2026-Q1")
  })
})
