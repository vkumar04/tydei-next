import { describe, it, expect } from "vitest"
import {
  tierInputSchema,
  termFormSchema,
} from "@/lib/validators/contract-terms"

describe("tier *Max validator coerces AI-extracted negatives to uncapped", () => {
  it("spendMax: -1 → undefined (was: 'Too small' ZodError, Bugs.rtfd 2026-05-25)", () => {
    const parsed = tierInputSchema.parse({
      tierNumber: 1,
      spendMin: 0,
      spendMax: -1,
      rebateType: "percent_of_spend",
      rebateValue: 0,
    })
    expect(parsed.spendMax).toBeUndefined()
  })

  it("volumeMax: -1 → undefined", () => {
    const parsed = tierInputSchema.parse({
      tierNumber: 1,
      spendMin: 0,
      volumeMax: -1,
      rebateType: "percent_of_spend",
      rebateValue: 0,
    })
    expect(parsed.volumeMax).toBeUndefined()
  })

  it("marketShareMax: -1 → undefined", () => {
    const parsed = tierInputSchema.parse({
      tierNumber: 1,
      spendMin: 0,
      marketShareMax: -1,
      rebateType: "percent_of_spend",
      rebateValue: 0,
    })
    expect(parsed.marketShareMax).toBeUndefined()
  })

  it("non-negative *Max passes through unchanged", () => {
    const parsed = tierInputSchema.parse({
      tierNumber: 1,
      spendMin: 0,
      spendMax: 50_000,
      rebateType: "percent_of_spend",
      rebateValue: 0,
    })
    expect(parsed.spendMax).toBe(50_000)
  })

  it("full term-form payload with AI-style negative tier passes", () => {
    const parsed = termFormSchema.parse({
      termName: "Refurbished Mako System (6 Annual Installments)",
      termType: "carve_out",
      baselineType: "spend_based",
      effectiveStart: "2023-12-22",
      effectiveEnd: "",
      tiers: [
        {
          tierNumber: 1,
          spendMin: 0,
          spendMax: -1, // AI-extracted "no upper bound" sentinel
          rebateType: "percent_of_spend",
          rebateValue: 0,
        },
      ],
    })
    expect(parsed.tiers?.[0]?.spendMax).toBeUndefined()
  })
})
