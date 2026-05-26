import { describe, it, expect } from "vitest"
import { mergeExtractedContracts } from "../contract-extract-merger"
import type { ExtractedContractData } from "../schemas"

const base = (over: Partial<ExtractedContractData> = {}): ExtractedContractData => ({
  contractName: "",
  vendorName: "",
  contractType: "usage",
  effectiveDate: null,
  expirationDate: null,
  terms: [],
  ...over,
})

describe("mergeExtractedContracts", () => {
  it("single part round-trips with defaults filled for header fields", () => {
    const only = base({ contractName: "X", vendorName: "Y", contractType: "tie_in" })
    const merged = mergeExtractedContracts([only])
    expect(merged.contractName).toBe("X")
    expect(merged.vendorName).toBe("Y")
    expect(merged.contractType).toBe("tie_in")
    expect(merged.terms).toEqual([])
  })

  it("first non-empty identity field wins (cover page bias)", () => {
    const merged = mergeExtractedContracts([
      base({ contractName: "Cover Page Name", vendorName: "Stryker", contractType: "tie_in" }),
      base({ contractName: "Footer Reprint", vendorName: "Stryker" }),
    ])
    expect(merged.contractName).toBe("Cover Page Name")
    expect(merged.vendorName).toBe("Stryker")
    expect(merged.contractType).toBe("tie_in")
  })

  it("later chunks fill blanks left by earlier chunks", () => {
    const merged = mergeExtractedContracts([
      base({ contractName: "X", vendorName: "Y", effectiveDate: null }),
      base({ effectiveDate: "2024-01-01" }),
    ])
    expect(merged.effectiveDate).toBe("2024-01-01")
  })

  it("dedupes terms by (termName + termType), keeps the chunk with more tiers", () => {
    const merged = mergeExtractedContracts([
      base({
        terms: [
          {
            termName: "Volume Rebate",
            termType: "volume_rebate",
            tiers: [
              { tierNumber: 1, spendMin: 0, rebateValue: 2, rebateType: "percent_of_spend", marketShareMin: 0, volumeMin: 0 },
            ],
          },
        ],
      }),
      base({
        terms: [
          {
            termName: "Volume Rebate",
            termType: "volume_rebate",
            tiers: [
              { tierNumber: 1, spendMin: 0, rebateValue: 2, rebateType: "percent_of_spend", marketShareMin: 0, volumeMin: 0 },
              { tierNumber: 2, spendMin: 100, rebateValue: 4, rebateType: "percent_of_spend", marketShareMin: 0, volumeMin: 0 },
              { tierNumber: 3, spendMin: 500, rebateValue: 6, rebateType: "percent_of_spend", marketShareMin: 0, volumeMin: 0 },
            ],
          },
        ],
      }),
    ])
    expect(merged.terms).toHaveLength(1)
    expect(merged.terms[0]?.tiers).toHaveLength(3)
  })

  it("productCategories: case-insensitive union, preserves first-seen casing", () => {
    const merged = mergeExtractedContracts([
      base({ productCategories: ["Ortho-Spine", "Ortho-Joints"] }),
      base({ productCategories: ["ortho-spine", "Ortho-Trauma"] }),
    ])
    expect(merged.productCategories).toEqual([
      "Ortho-Spine",
      "Ortho-Joints",
      "Ortho-Trauma",
    ])
  })

  it("fieldConfidences: max-across-chunks per field", () => {
    const merged = mergeExtractedContracts([
      base({ fieldConfidences: { contractName: 0.6, vendorName: 0.9 } }),
      base({ fieldConfidences: { contractName: 0.95, expirationDate: 0.4 } }),
    ])
    expect(merged.fieldConfidences).toEqual({
      contractName: 0.95,
      vendorName: 0.9,
      expirationDate: 0.4,
    })
  })
})
