/**
 * toRichExtractedContract — flat→rich capital lift.
 *
 * 2026-06-15 (Vick "still not getting the capital"): the /api/ai/
 * extract-contract route returns the FLAT ExtractedContractData
 * (capitalCost/termMonths/…), but ingestExtractedContracts reads the RICH
 * tieInDetails shape. The mass-upload boundary cast flat→rich, so a
 * correctly-extracted capital value (ROSA tie-in's $785,195) was dropped at
 * import. These tests pin the lift so it can't silently regress.
 */
import { describe, it, expect } from "vitest"
import { toRichExtractedContract } from "@/lib/ai/contract-extract-mapper"

describe("toRichExtractedContract", () => {
  it("builds tieInDetails from the flat capital fields (the ROSA case)", () => {
    const rich = toRichExtractedContract({
      contractName: "Zimmer Biomet Directed Rebate Agreement",
      contractType: "tie_in",
      capitalCost: 785195,
      interestRatePercent: 4.953,
      termMonths: 60,
      paymentCadence: "quarterly",
      downPayment: 0,
    })
    expect(rich.tieInDetails).toEqual({
      capitalEquipmentValue: 785195,
      payoffPeriodMonths: 60,
      interestRatePercent: 4.953,
      paymentCadence: "quarterly",
      downPayment: 0,
      linkedProductCategories: null,
    })
  })

  it("is idempotent — keeps an existing non-null tieInDetails", () => {
    const rich = toRichExtractedContract({
      capitalCost: 123, // should be ignored in favor of existing tieInDetails
      tieInDetails: {
        capitalEquipmentValue: 999,
        payoffPeriodMonths: null,
        interestRatePercent: null,
        paymentCadence: null,
        downPayment: null,
        linkedProductCategories: null,
      },
    })
    expect(rich.tieInDetails?.capitalEquipmentValue).toBe(999)
  })

  it("returns null tieInDetails when there are no capital fields", () => {
    const rich = toRichExtractedContract({
      contractName: "Plain Usage Rebate Agreement",
      contractType: "usage",
    })
    expect(rich.tieInDetails).toBeNull()
  })

  it("lifts a partial capital payload (downPayment only)", () => {
    const rich = toRichExtractedContract({ downPayment: 50000 })
    expect(rich.tieInDetails).toEqual({
      capitalEquipmentValue: null,
      payoffPeriodMonths: null,
      interestRatePercent: null,
      paymentCadence: null,
      downPayment: 50000,
      linkedProductCategories: null,
    })
  })

  it("passes through all non-capital fields unchanged", () => {
    const rich = toRichExtractedContract({
      contractName: "X",
      vendorName: "Y",
      capitalCost: 100,
    })
    expect(rich.contractName).toBe("X")
    expect(rich.vendorName).toBe("Y")
  })
})
