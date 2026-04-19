/**
 * Tie-in capital schedule fields on the term form schema. The UI
 * renders `capitalCost / interestRate / termMonths` inputs only when
 * `contractType === "tie_in"`; this test locks in that the validator
 * accepts and round-trips them.
 */
import { describe, it, expect } from "vitest"
import { termFormSchema } from "@/lib/validators/contract-terms"

describe("termFormSchema — tie-in capital fields", () => {
  const base = {
    termName: "Capital schedule",
    termType: "fixed_fee" as const,
    baselineType: "spend_based" as const,
    evaluationPeriod: "annual",
    paymentTiming: "quarterly",
    appliesTo: "all_products",
    rebateMethod: "cumulative" as const,
    effectiveStart: "2026-01-01",
    effectiveEnd: "2029-01-01",
    tiers: [],
  }

  it("accepts capitalCost / interestRate / termMonths", () => {
    const parsed = termFormSchema.parse({
      ...base,
      capitalCost: 350_000,
      interestRate: 0.0525,
      termMonths: 60,
    })
    expect(parsed.capitalCost).toBe(350_000)
    expect(parsed.interestRate).toBeCloseTo(0.0525)
    expect(parsed.termMonths).toBe(60)
  })

  it("accepts null for each tie-in field (cleared inputs)", () => {
    const parsed = termFormSchema.parse({
      ...base,
      capitalCost: null,
      interestRate: null,
      termMonths: null,
    })
    expect(parsed.capitalCost).toBeNull()
    expect(parsed.interestRate).toBeNull()
    expect(parsed.termMonths).toBeNull()
  })

  it("accepts the form when tie-in fields are omitted entirely", () => {
    const parsed = termFormSchema.parse(base)
    expect(parsed.capitalCost).toBeUndefined()
    expect(parsed.interestRate).toBeUndefined()
    expect(parsed.termMonths).toBeUndefined()
  })

  it("rejects non-integer termMonths", () => {
    expect(() =>
      termFormSchema.parse({ ...base, termMonths: 60.5 }),
    ).toThrow()
  })
})
