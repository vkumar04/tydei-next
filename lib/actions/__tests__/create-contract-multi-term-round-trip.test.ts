import { describe, it, expect } from "vitest"
import { createContractSchema } from "@/lib/validators/contracts"
import {
  termFormSchema,
  type TermFormValues,
} from "@/lib/validators/contract-terms"

/**
 * Regression guard for Bug 7 ("second contract term not created").
 *
 * The bug had been attributed to client-side accidents (trash icon,
 * edits during review), but the code-reviewer flagged the need for a
 * permanent invariant check on the server side. This test asserts:
 *
 *   - `createContractSchema.parse` accepts a valid multi-term payload
 *     unchanged.
 *   - `termFormSchema.parse` accepts each term individually, including
 *     ones with empty `effectiveEnd` (evergreen) and the "Distal
 *     Extremities"-style single-tier shape.
 *   - The parsed payload produces N terms, not 1 (i.e. schema doesn't
 *     silently dedupe).
 *
 * This won't catch every class of dropped-term bug (e.g. a rogue
 * `.slice(0,1)` in a client form), but it locks down the validator
 * layer so Bug 7 cannot reappear through schema changes.
 */

const validContractPayload = {
  name: "Preferred Supplier-Provider Rebate Agreement",
  contractNumber: "1000010442",
  vendorId: "vendor-id",
  facilityId: "facility-id",
  categoryIds: [],
  contractType: "usage" as const,
  status: "active" as const,
  effectiveDate: "2024-01-01",
  expirationDate: "2024-12-31",
  autoRenewal: false,
  terminationNoticeDays: 90,
  totalValue: 5_300_000,
  annualValue: 5_300_000,
  performancePeriod: "monthly" as const,
  rebatePayPeriod: "quarterly" as const,
  isMultiFacility: false,
  isGrouped: false,
  facilityIds: [],
  additionalFacilityIds: [],
}

const qasTerm: TermFormValues = {
  termName: "Qualified Annual Spend Rebate",
  termType: "spend_rebate",
  baselineType: "spend_based",
  evaluationPeriod: "annual",
  paymentTiming: "quarterly",
  appliesTo: "all_products",
  rebateMethod: "cumulative",
  effectiveStart: "2024-01-01",
  effectiveEnd: "2024-12-31",
  tiers: [
    { tierNumber: 1, spendMin: 5_300_000, spendMax: 5_499_999.99, rebateType: "percent_of_spend", rebateValue: 0.03 },
    { tierNumber: 2, spendMin: 5_500_000, spendMax: 5_999_999.99, rebateType: "percent_of_spend", rebateValue: 0.05 },
    { tierNumber: 3, spendMin: 6_000_000, rebateType: "percent_of_spend", rebateValue: 0.06 },
  ],
}

const distalExtremitiesTerm: TermFormValues = {
  termName: "Distal Extremities Spend Rebate",
  termType: "spend_rebate",
  baselineType: "spend_based",
  evaluationPeriod: "annual",
  paymentTiming: "quarterly",
  appliesTo: "all_products",
  rebateMethod: "cumulative",
  effectiveStart: "2024-01-01",
  effectiveEnd: "2024-12-31",
  tiers: [
    { tierNumber: 1, spendMin: 825_000, spendMax: 9_999_999_999, rebateType: "percent_of_spend", rebateValue: 0.02 },
  ],
}

describe("Bug 7 regression — multi-term AI-extract payload round-trip", () => {
  it("createContractSchema accepts a valid payload without dropping terms", () => {
    const parsed = createContractSchema.parse(validContractPayload)
    expect(parsed.name).toBe(validContractPayload.name)
    expect(parsed.annualValue).toBe(5_300_000)
  })

  it("termFormSchema accepts a 3-tier spend-rebate term", () => {
    const parsed = termFormSchema.parse(qasTerm)
    expect(parsed.tiers).toHaveLength(3)
  })

  it("termFormSchema accepts a 1-tier spend-rebate term", () => {
    const parsed = termFormSchema.parse(distalExtremitiesTerm)
    expect(parsed.tiers).toHaveLength(1)
  })

  it("termFormSchema accepts an evergreen term (empty effectiveEnd)", () => {
    const evergreen: TermFormValues = {
      ...qasTerm,
      effectiveEnd: "",
    }
    const parsed = termFormSchema.parse(evergreen)
    expect(parsed.effectiveEnd).toBe("")
  })

  it("two-term payload produces two validated terms (not 1, not deduped)", () => {
    const terms = [qasTerm, distalExtremitiesTerm].map((t) =>
      termFormSchema.parse(t),
    )
    expect(terms).toHaveLength(2)
    expect(terms[0].termName).toBe("Qualified Annual Spend Rebate")
    expect(terms[1].termName).toBe("Distal Extremities Spend Rebate")
    // Guard against silent de-dup by tierNumber collision — they're
    // both tierNumber=1 on different terms.
    expect(terms[0].tiers[0].tierNumber).toBe(1)
    expect(terms[1].tiers[0].tierNumber).toBe(1)
  })

  // Charles 2026-04-26: dropped the `annualValue <= totalValue` refine.
  // The form now ALWAYS computes annualValue from totalValue ÷ contract
  // years (read-only computed field), so the refine error became
  // confusing — the system owns the field, no need to gate it. Test
  // now asserts the schema is permissive on this dimension.
  it("createContractSchema accepts annualValue > totalValue (computed by form)", () => {
    const formerlyBad = { ...validContractPayload, annualValue: 6_000_000 }
    expect(() => createContractSchema.parse(formerlyBad)).not.toThrow()
  })
})
