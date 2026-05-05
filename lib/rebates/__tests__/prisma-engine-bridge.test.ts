/**
 * Bridge: Prisma `ContractTerm` + `ContractTier` → engine `RebateConfig`.
 *
 * Covers the happy-path mapping per termType plus the null-fallback
 * cases that callers rely on to know when to fall back to a hand-rolled
 * path.
 *
 * Reference: lib/rebates/prisma-engine-bridge.ts
 */
import { describe, it, expect } from "vitest"
import { Prisma } from "@prisma/client"
import type {
  ContractTerm as PrismaContractTerm,
  ContractTier as PrismaContractTier,
} from "@prisma/client"
import { buildRebateConfigFromPrisma } from "@/lib/rebates/prisma-engine-bridge"

function tier(
  partial: Partial<PrismaContractTier> & { tierNumber: number },
): PrismaContractTier {
  return {
    id: `tier-${partial.tierNumber}`,
    termId: "term-1",
    tierNumber: partial.tierNumber,
    tierName: partial.tierName ?? null,
    spendMin: partial.spendMin ?? new Prisma.Decimal(0),
    spendMax: partial.spendMax ?? null,
    volumeMin: partial.volumeMin ?? null,
    volumeMax: partial.volumeMax ?? null,
    marketShareMin: partial.marketShareMin ?? null,
    marketShareMax: partial.marketShareMax ?? null,
    rebateType: partial.rebateType ?? "percent_of_spend",
    rebateValue: partial.rebateValue ?? new Prisma.Decimal(0),
    fixedRebateAmount: partial.fixedRebateAmount ?? null,
    reducedPrice: partial.reducedPrice ?? null,
    priceReductionPercent: partial.priceReductionPercent ?? null,
    createdAt: new Date(),
  } as PrismaContractTier
}

function term(
  partial: Partial<PrismaContractTerm> & { termType: PrismaContractTerm["termType"] },
  tiers: PrismaContractTier[] = [],
): PrismaContractTerm & { tiers: PrismaContractTier[] } {
  const base: PrismaContractTerm = {
    id: "term-1",
    contractId: "contract-1",
    termName: partial.termName ?? "Test term",
    termType: partial.termType,
    baselineType: partial.baselineType ?? "spend_based",
    evaluationPeriod: partial.evaluationPeriod ?? "annual",
    paymentTiming: partial.paymentTiming ?? "quarterly",
    appliesTo: partial.appliesTo ?? "all_products",
    rebateMethod: partial.rebateMethod ?? "cumulative",
    effectiveStart: partial.effectiveStart ?? new Date("2025-01-01"),
    effectiveEnd: partial.effectiveEnd ?? new Date("2025-12-31"),
    volumeType: partial.volumeType ?? null,
    spendBaseline: partial.spendBaseline ?? null,
    volumeBaseline: partial.volumeBaseline ?? null,
    growthBaselinePercent: partial.growthBaselinePercent ?? null,
    desiredMarketShare: partial.desiredMarketShare ?? null,
    boundaryRule: partial.boundaryRule ?? null,
    priceReductionTrigger: partial.priceReductionTrigger ?? null,
    shortfallHandling: partial.shortfallHandling ?? "carry_forward",
    negotiatedBaseline: partial.negotiatedBaseline ?? null,
    growthOnly: partial.growthOnly ?? false,
    periodCap: partial.periodCap ?? null,
    fixedRebatePerOccurrence: partial.fixedRebatePerOccurrence ?? null,
    minimumPurchaseCommitment: partial.minimumPurchaseCommitment ?? null,
    adminFeePercent: partial.adminFeePercent ?? null,
    cptCodes: partial.cptCodes ?? [],
    groupedReferenceNumbers: partial.groupedReferenceNumbers ?? [],
    referenceNumbers: partial.referenceNumbers ?? [],
    categories: partial.categories ?? [],
    marketShareVendorId: partial.marketShareVendorId ?? null,
    marketShareCategory: partial.marketShareCategory ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as PrismaContractTerm
  return { ...base, tiers }
}

describe("buildRebateConfigFromPrisma — type routing", () => {
  it("returns SPEND_REBATE for spend_rebate term", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "spend_rebate" }, [
        tier({ tierNumber: 1, rebateValue: new Prisma.Decimal(0.02) }),
      ]),
    )
    expect(cfg).not.toBeNull()
    expect(cfg!.type).toBe("SPEND_REBATE")
  })

  it("returns VOLUME_REBATE for volume_rebate term", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "volume_rebate", cptCodes: ["66984"] }, [
        tier({ tierNumber: 1, rebateValue: new Prisma.Decimal(50) }),
      ]),
    )
    expect(cfg).not.toBeNull()
    expect(cfg!.type).toBe("VOLUME_REBATE")
  })

  it("routes rebate_per_use to VOLUME_REBATE", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "rebate_per_use", cptCodes: ["27447"] }, [
        tier({ tierNumber: 1 }),
      ]),
    )
    expect(cfg!.type).toBe("VOLUME_REBATE")
  })

  it("returns TIER_PRICE_REDUCTION for price_reduction term", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "price_reduction" }, [
        tier({
          tierNumber: 1,
          reducedPrice: new Prisma.Decimal(95),
        }),
      ]),
    )
    expect(cfg!.type).toBe("TIER_PRICE_REDUCTION")
  })

  it("returns MARKET_SHARE_REBATE for market_share term", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "market_share" }, [
        tier({
          tierNumber: 1,
          spendMin: new Prisma.Decimal(40),
          rebateValue: new Prisma.Decimal(0.03),
        }),
      ]),
    )
    expect(cfg!.type).toBe("MARKET_SHARE_REBATE")
  })

  it("returns CAPITATED for capitated_price_reduction with periodCap", () => {
    const cfg = buildRebateConfigFromPrisma(
      term(
        {
          termType: "capitated_price_reduction",
          periodCap: new Prisma.Decimal(500_000),
        },
        [tier({ tierNumber: 1, rebateValue: new Prisma.Decimal(0.02) })],
      ),
    )
    expect(cfg).not.toBeNull()
    expect(cfg!.type).toBe("CAPITATED")
  })

  it("returns null for carve_out (uses ContractPricing instead)", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "carve_out" }, [tier({ tierNumber: 1 })]),
    )
    expect(cfg).toBeNull()
  })

  it("returns null when there are no tiers and no periodCap", () => {
    const cfg = buildRebateConfigFromPrisma(term({ termType: "spend_rebate" }))
    expect(cfg).toBeNull()
  })
})

describe("buildRebateConfigFromPrisma — unit scaling", () => {
  it("scales percent_of_spend tier from 0.02 to 2", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "spend_rebate" }, [
        tier({
          tierNumber: 1,
          rebateType: "percent_of_spend",
          rebateValue: new Prisma.Decimal(0.02),
        }),
      ]),
    )
    expect(cfg!.type).toBe("SPEND_REBATE")
    if (cfg!.type === "SPEND_REBATE") {
      expect(cfg!.tiers[0]!.rebateValue).toBe(2)
    }
  })

  it("threads fixed_rebate dollars onto fixedRebateAmount", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "spend_rebate" }, [
        tier({
          tierNumber: 1,
          rebateType: "fixed_rebate",
          rebateValue: new Prisma.Decimal(30_000),
        }),
      ]),
    )
    if (cfg!.type === "SPEND_REBATE") {
      expect(cfg!.tiers[0]!.rebateValue).toBe(0)
      expect(cfg!.tiers[0]!.fixedRebateAmount).toBe(30_000)
    }
  })

  it("scales fixed_rebate_per_unit dollar value by 100 (engine's /100 yields count × $X)", () => {
    // VOLUME_REBATE: tier rebateValue=$50/unit. Engine math is
    // (occurrences × tier.rebateValue) / 100. For the engine to output
    // $50 per occurrence, tier.rebateValue must arrive as 5000.
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "volume_rebate", cptCodes: ["66984"] }, [
        tier({
          tierNumber: 1,
          rebateType: "fixed_rebate_per_unit",
          rebateValue: new Prisma.Decimal(50),
        }),
      ]),
    )
    expect(cfg!.type).toBe("VOLUME_REBATE")
    if (cfg!.type === "VOLUME_REBATE") {
      expect(cfg!.tiers[0]!.rebateValue).toBe(5000)
      expect(cfg!.tiers[0]!.fixedRebateAmount).toBeNull()
    }
  })

  it("scales per_procedure_rebate dollar value by 100", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "volume_rebate", cptCodes: ["27447"] }, [
        tier({
          tierNumber: 1,
          rebateType: "per_procedure_rebate",
          rebateValue: new Prisma.Decimal(75),
        }),
      ]),
    )
    if (cfg!.type === "VOLUME_REBATE") {
      expect(cfg!.tiers[0]!.rebateValue).toBe(7500)
    }
  })
})

describe("buildRebateConfigFromPrisma — engine math equivalence", () => {
  it("VOLUME_REBATE per-unit tier × engine == production count × rebateValue", async () => {
    // Production volume writer (lib/contracts/recompute/volume.ts:244):
    //   rebate = occurrences × tier.rebateValue (raw dollars-per-unit)
    // Engine (calculateVolumeRebate via shared cumulative helpers):
    //   rebate = (occurrences × tier.rebateValue) / 100
    // The bridge ×100 scaling makes these equal.
    const { calculateRebate } = await import("@/lib/rebates/engine")
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "volume_rebate", cptCodes: ["66984"] }, [
        tier({
          tierNumber: 1,
          spendMin: new Prisma.Decimal(0),
          rebateType: "fixed_rebate_per_unit",
          rebateValue: new Prisma.Decimal(50),
        }),
      ]),
    )
    expect(cfg!.type).toBe("VOLUME_REBATE")

    // 10 occurrences × $50 = $500 expected
    const purchases = Array.from({ length: 10 }, (_, i) => ({
      referenceNumber: `ref-${i}`,
      quantity: 1,
      unitPrice: 0,
      extendedPrice: 0,
      purchaseDate: new Date(`2025-01-${String(i + 1).padStart(2, "0")}`),
      cptCode: "66984",
      caseId: `case-${i}`,
    }))
    const result = calculateRebate(cfg!, {
      purchases,
      totalSpend: 0,
    })
    expect(result.rebateEarned).toBe(500)
  })
})

describe("buildRebateConfigFromPrisma — spendBasis routing", () => {
  it("ALL_SPEND when appliesTo=all_products", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "spend_rebate", appliesTo: "all_products" }, [
        tier({ tierNumber: 1 }),
      ]),
    )
    if (cfg!.type === "SPEND_REBATE") {
      expect(cfg!.spendBasis).toBe("ALL_SPEND")
    }
  })

  it("PRODUCT_CATEGORY when appliesTo=specific_category with one category", () => {
    const cfg = buildRebateConfigFromPrisma(
      term(
        {
          termType: "spend_rebate",
          appliesTo: "specific_category",
          categories: ["Spine"],
        },
        [tier({ tierNumber: 1 })],
      ),
    )
    if (cfg!.type === "SPEND_REBATE") {
      expect(cfg!.spendBasis).toBe("PRODUCT_CATEGORY")
      expect(cfg!.productCategory).toBe("Spine")
    }
  })

  it("MULTI_CATEGORY when specific_category with multiple categories", () => {
    const cfg = buildRebateConfigFromPrisma(
      term(
        {
          termType: "spend_rebate",
          appliesTo: "specific_category",
          categories: ["Spine", "Cardio"],
        },
        [tier({ tierNumber: 1 })],
      ),
    )
    if (cfg!.type === "SPEND_REBATE") {
      expect(cfg!.spendBasis).toBe("MULTI_CATEGORY")
      expect(cfg!.categories).toEqual(["Spine", "Cardio"])
    }
  })
})

describe("buildRebateConfigFromPrisma — baseline + method", () => {
  it("maps growth_based + growthOnly to PRIOR_YEAR_ACTUAL", () => {
    const cfg = buildRebateConfigFromPrisma(
      term(
        {
          termType: "spend_rebate",
          baselineType: "growth_based",
          growthOnly: true,
        },
        [tier({ tierNumber: 1 })],
      ),
    )
    if (cfg!.type === "SPEND_REBATE") {
      expect(cfg!.baselineType).toBe("PRIOR_YEAR_ACTUAL")
      expect(cfg!.growthOnly).toBe(true)
    }
  })

  it("maps NEGOTIATED_FIXED when negotiatedBaseline set", () => {
    const cfg = buildRebateConfigFromPrisma(
      term(
        {
          termType: "spend_rebate",
          negotiatedBaseline: new Prisma.Decimal(1_000_000),
        },
        [tier({ tierNumber: 1 })],
      ),
    )
    if (cfg!.type === "SPEND_REBATE") {
      expect(cfg!.baselineType).toBe("NEGOTIATED_FIXED")
      expect(cfg!.negotiatedBaseline).toBe(1_000_000)
    }
  })

  it("maps marginal rebateMethod to MARGINAL", () => {
    const cfg = buildRebateConfigFromPrisma(
      term({ termType: "spend_rebate", rebateMethod: "marginal" }, [
        tier({ tierNumber: 1 }),
      ]),
    )
    if (cfg!.type === "SPEND_REBATE") {
      expect(cfg!.method).toBe("MARGINAL")
    }
  })
})
