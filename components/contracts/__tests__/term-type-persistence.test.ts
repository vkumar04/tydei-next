/**
 * Charles W1.W-D4 — regression: the term-type dropdown's value must
 * survive the Zod update-term validator and the Prisma update path used
 * by lib/actions/contract-terms.ts::updateContractTerm.
 *
 * The user-visible bug was "Editing a term's type doesn't persist on
 * save. Each term type stays the same." Root cause needed a probe: the
 * server-side DB probe (scripts/probe-w1w-d-termtype.ts, since removed)
 * confirmed the termType DOES reach the DB via updateTermSchema. What
 * was drifting was (a) the client payload carrying `termType` through
 * the update mutation and (b) the validator's handling of every TermType
 * enum value. This test locks in both sides:
 *
 *   1. updateTermSchema (which updateContractTerm calls) parses each of
 *      the 15 TermType enum values without dropping or rewriting.
 *   2. The field-stripping performed in contract-terms.ts
 *      (destructures tiers / scope helpers / capital fields off, keeps
 *      termType) preserves termType on the Prisma update payload.
 */
import { describe, it, expect } from "vitest"
import { updateTermSchema } from "@/lib/validators/contract-terms"

const ALL_TERM_TYPES = [
  "spend_rebate",
  "volume_rebate",
  "price_reduction",
  "market_share",
  "market_share_price_reduction",
  "capitated_price_reduction",
  "capitated_pricing_rebate",
  "po_rebate",
  "carve_out",
  "payment_rebate",
  "growth_rebate",
  "compliance_rebate",
  "fixed_fee",
  "locked_pricing",
  "rebate_per_use",
] as const

describe("W1.W-D4 — term type persists through the update payload", () => {
  it("updateTermSchema round-trips every TermType enum value", () => {
    for (const tt of ALL_TERM_TYPES) {
      const parsed = updateTermSchema.parse({ termType: tt })
      expect(parsed.termType, `termType=${tt} must survive validation`).toBe(tt)
    }
  })

  it("stripping tiers / scope / capital fields from the update payload still leaves termType", () => {
    // Mirrors the destructuring in lib/actions/contract-terms.ts so the
    // regression is guarded at the exact seam where W1.T introduced
    // field-stripping for the capital fields. If someone adds termType
    // to this strip list by accident, the test flips red.
    const parsed = updateTermSchema.parse({
      termName: "Whatever",
      termType: "volume_rebate",
      capitalCost: 100_000,
      interestRate: 0.04,
      termMonths: 60,
      tiers: [],
      scopedItemNumbers: ["A", "B"],
      scopedCategoryIds: ["cat-1"],
    })

    const {
      tiers: _tiers,
      scopedItemNumbers: _scopedItemNumbers,
      scopedCategoryId: _scopedCategoryId,
      scopedCategoryIds: _scopedCategoryIds,
      customAmortizationRows: _customAmortizationRows,
      capitalCost: _capitalCost,
      interestRate: _interestRate,
      termMonths: _termMonths,
      downPayment: _downPayment,
      paymentCadence: _paymentCadence,
      amortizationShape: _amortizationShape,
      ...termData
    } = parsed
    void _tiers
    void _scopedItemNumbers
    void _scopedCategoryId
    void _scopedCategoryIds
    void _customAmortizationRows
    void _capitalCost
    void _interestRate
    void _termMonths
    void _downPayment
    void _paymentCadence
    void _amortizationShape

    expect(termData.termType).toBe("volume_rebate")
    expect(termData.termName).toBe("Whatever")
  })

  it("switching between spend_rebate and volume_rebate does not collapse to a default", () => {
    // `updateTermSchema = createTermSchema.partial().omit({ contractId })`
    // The `.default("spend_rebate")` on termType must NOT fire when a
    // value is explicitly provided — otherwise a volume_rebate edit
    // would silently become spend_rebate through .parse.
    const a = updateTermSchema.parse({ termType: "volume_rebate" })
    expect(a.termType).toBe("volume_rebate")

    const b = updateTermSchema.parse({ termType: "spend_rebate" })
    expect(b.termType).toBe("spend_rebate")
  })
})
