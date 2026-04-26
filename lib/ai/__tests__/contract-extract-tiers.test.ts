import { describe, it, expect } from "vitest"
import { extractedContractSchema } from "@/lib/ai/schemas"
import { toLegacyExtractedContract } from "@/lib/ai/contract-extract-mapper"

// Charles W1.W-E2 — the AI extraction for a usage contract was
// returning ZERO tiers and forcing the user to add them by hand. Lock
// down the schema shape (a 3-tier spend-rebate response parses cleanly
// and preserves every field downstream) and the legacy mapper (it
// doesn't drop tiers on the way from rich → legacy).

const THREE_TIER_RESPONSE = {
  contractName: "Acme Spine Implants 2026",
  contractNumber: "ACME-SP-26",
  vendorName: "Acme Medical",
  contractType: "usage",
  effectiveDate: "2026-01-01",
  expirationDate: "2026-12-31",
  productCategory: "Ortho Spine",
  terms: [
    {
      termName: "Annual Spend Rebate",
      termType: "spend_rebate",
      tiers: [
        {
          tierNumber: 1,
          spendMin: 0,
          spendMax: 750_000,
          rebateType: "percent_of_spend",
          rebateValue: 3,
        },
        {
          tierNumber: 2,
          spendMin: 750_000,
          spendMax: 1_500_000,
          rebateType: "percent_of_spend",
          rebateValue: 5,
        },
        {
          tierNumber: 3,
          spendMin: 1_500_000,
          rebateType: "percent_of_spend",
          rebateValue: 7,
        },
      ],
    },
  ],
}

describe("extractedContractSchema — 3-tier usage contract (W1.W-E2)", () => {
  it("parses a 3-tier spend-rebate response without dropping tiers", () => {
    const parsed = extractedContractSchema.parse(THREE_TIER_RESPONSE)
    expect(parsed.terms).toHaveLength(1)
    expect(parsed.terms[0].tiers).toHaveLength(3)
    expect(parsed.terms[0].tiers.map((t) => t.rebateValue)).toEqual([3, 5, 7])
    expect(parsed.terms[0].tiers[0].spendMin).toBe(0)
    // spendMax was removed from the schema (Anthropic 24-optional limit).
    // The rebate engine derives each tier's ceiling from the next tier's
    // spendMin instead. Verify the field doesn't surface.
    expect(
      (parsed.terms[0].tiers[2] as Record<string, unknown>).spendMax,
    ).toBeUndefined()
  })

  it("rejects a response that is missing the required `terms` array", () => {
    const missingTerms = { ...THREE_TIER_RESPONSE, terms: undefined }
    expect(() => extractedContractSchema.parse(missingTerms)).toThrow()
  })
})

describe("toLegacyExtractedContract — tier preservation (W1.W-E2)", () => {
  it("preserves every tier and its rebateValue/spendMin/spendMax/rebateType", () => {
    const rich = {
      contractName: "Rich 3-Tier",
      contractId: "RICH-001",
      vendorName: "Rich Vendor",
      vendorDivision: null,
      contractType: "usage" as const,
      productCategory: "Ortho Spine",
      productCategories: null,
      effectiveDate: "2026-01-01",
      expirationDate: "2026-12-31",
      rebatePayPeriod: "quarterly" as const,
      isGroupedContract: false,
      isCapitalContract: false,
      isServiceContract: false,
      isPricingOnly: false,
      facilities: null,
      terms: [
        {
          termName: "Spine Spend Rebate",
          termType: "spend_rebate" as const,
          effectiveFrom: null,
          effectiveTo: null,
          performancePeriod: null,
          volumeType: null,
          tiers: [
            {
              tierNumber: 1,
              marketShareMin: null,
              marketShareMax: null,
              spendMin: 0,
              spendMax: 750_000,
              volumeMin: null,
              volumeMax: null,
              rebateType: "percent_of_spend" as const,
              rebateValue: 3,
              spendBaseline: null,
              growthBaseline: null,
            },
            {
              tierNumber: 2,
              marketShareMin: null,
              marketShareMax: null,
              spendMin: 750_000,
              spendMax: null,
              volumeMin: null,
              volumeMax: null,
              rebateType: "percent_of_spend" as const,
              rebateValue: 5,
              spendBaseline: null,
              growthBaseline: null,
            },
          ],
          products: null,
        },
      ],
      tieInDetails: null,
      specialConditions: null,
      contactInfo: null,
    }
    const legacy = toLegacyExtractedContract(rich)
    expect(legacy.terms).toHaveLength(1)
    expect(legacy.terms[0].tiers).toHaveLength(2)
    expect(legacy.terms[0].tiers.map((t) => t.rebateValue)).toEqual([3, 5])
    expect(legacy.terms[0].tiers[0].spendMin).toBe(0)
    expect(legacy.terms[0].tiers[0].spendMax).toBe(750_000)
    expect(legacy.terms[0].tiers[1].spendMax).toBeUndefined()
  })

  it("returns an empty tiers array (not undefined) when rich.terms[i].tiers is null", () => {
    // Regression: make sure the `t.tiers ?? []` fallback doesn't morph
    // into an undefined downstream consumer trips on.
    const rich = {
      contractName: null,
      contractId: null,
      vendorName: null,
      vendorDivision: null,
      contractType: "pricing_only" as const,
      productCategory: null,
      productCategories: null,
      effectiveDate: null,
      expirationDate: null,
      rebatePayPeriod: null,
      isGroupedContract: null,
      isCapitalContract: null,
      isServiceContract: null,
      isPricingOnly: true,
      facilities: null,
      terms: [
        {
          termName: "No Tiers Here",
          termType: "locked_pricing" as const,
          effectiveFrom: null,
          effectiveTo: null,
          performancePeriod: null,
          volumeType: null,
          tiers: null,
          products: null,
        },
      ],
      tieInDetails: null,
      specialConditions: null,
      contactInfo: null,
    }
    const legacy = toLegacyExtractedContract(rich)
    expect(legacy.terms[0].tiers).toEqual([])
  })
})
