import { describe, it, expect } from "vitest"
import {
  validateProposedTerms,
  validateReviewDecision,
  ProposalValidationError,
} from "../proposal-review"

describe("validateProposedTerms", () => {
  it("accepts a fully-specified payload", () => {
    const r = validateProposedTerms({
      effectiveDate: "2026-07-01",
      expirationDate: "2028-06-30",
      priceChangePercent: -5,
      rebateRateChangePercent: 2,
      narrative: "Adding Q4 promotional discount",
    })
    expect(r.effectiveDate).toBeInstanceOf(Date)
    expect(r.expirationDate).toBeInstanceOf(Date)
    expect(r.priceChangePercent).toBe(-5)
    expect(r.rebateRateChangePercent).toBe(2)
    expect(r.narrative).toBe("Adding Q4 promotional discount")
  })

  it("accepts all-null fields", () => {
    const r = validateProposedTerms({
      effectiveDate: null,
      expirationDate: null,
      priceChangePercent: null,
      rebateRateChangePercent: null,
      narrative: null,
    })
    expect(r.effectiveDate).toBeNull()
    expect(r.priceChangePercent).toBeNull()
    expect(r.narrative).toBeNull()
  })

  it("accepts Date objects directly", () => {
    const d = new Date("2026-07-01")
    const r = validateProposedTerms({
      effectiveDate: d,
      expirationDate: null,
    })
    expect(r.effectiveDate).toEqual(d)
  })

  it("rejects non-object input", () => {
    expect(() => validateProposedTerms(null)).toThrow(ProposalValidationError)
    expect(() => validateProposedTerms("string")).toThrow(ProposalValidationError)
  })

  it("rejects expirationDate on/before effectiveDate", () => {
    expect(() =>
      validateProposedTerms({
        effectiveDate: "2026-07-01",
        expirationDate: "2026-06-30",
      }),
    ).toThrow(/expirationDate/)
    expect(() =>
      validateProposedTerms({
        effectiveDate: "2026-07-01",
        expirationDate: "2026-07-01",
      }),
    ).toThrow(/strictly after/)
  })

  it("accepts expirationDate strictly after effectiveDate", () => {
    expect(() =>
      validateProposedTerms({
        effectiveDate: "2026-07-01",
        expirationDate: "2026-07-02",
      }),
    ).not.toThrow()
  })

  it("rejects non-finite percent values", () => {
    expect(() =>
      validateProposedTerms({ priceChangePercent: Number.NaN }),
    ).toThrow(/finite/)
    expect(() =>
      validateProposedTerms({ rebateRateChangePercent: Number.POSITIVE_INFINITY }),
    ).toThrow(/finite/)
  })

  it("rejects out-of-range percents (>100%)", () => {
    expect(() =>
      validateProposedTerms({ priceChangePercent: 150 }),
    ).toThrow(/out of range/)
    expect(() =>
      validateProposedTerms({ priceChangePercent: -101 }),
    ).toThrow(/out of range/)
  })

  it("accepts percents at exactly ±100%", () => {
    expect(() =>
      validateProposedTerms({
        priceChangePercent: 100,
        rebateRateChangePercent: -100,
      }),
    ).not.toThrow()
  })

  it("trims + nulls out empty narrative", () => {
    const r = validateProposedTerms({ narrative: "   " })
    expect(r.narrative).toBeNull()
    const r2 = validateProposedTerms({ narrative: "  keep  " })
    expect(r2.narrative).toBe("keep")
  })

  it("rejects bogus date strings", () => {
    const r = validateProposedTerms({ effectiveDate: "not-a-date" })
    expect(r.effectiveDate).toBeNull()
  })
})

describe("validateReviewDecision", () => {
  it("accepts approved with no note", () => {
    const r = validateReviewDecision({ decision: "approved", note: "" })
    expect(r).toEqual({ decision: "approved", note: "" })
  })

  it("accepts approved with optional note", () => {
    const r = validateReviewDecision({
      decision: "approved",
      note: "Looks good",
    })
    expect(r.note).toBe("Looks good")
  })

  it("requires ≥10-char note for rejected", () => {
    expect(() =>
      validateReviewDecision({ decision: "rejected", note: "no" }),
    ).toThrow(/≥ 10 characters/)
    expect(() =>
      validateReviewDecision({
        decision: "rejected",
        note: "Pricing too high; reconsider",
      }),
    ).not.toThrow()
  })

  it("requires ≥10-char note for countered", () => {
    expect(() =>
      validateReviewDecision({ decision: "countered", note: "short" }),
    ).toThrow(/≥ 10 characters/)
  })

  it("rejects unknown decision", () => {
    expect(() =>
      validateReviewDecision({ decision: "maybe", note: "irrelevant" }),
    ).toThrow(/approved/)
  })

  it("rejects non-string decision", () => {
    expect(() =>
      validateReviewDecision({ decision: 1, note: "" }),
    ).toThrow(/decision/)
  })

  it("rejects non-object input", () => {
    expect(() => validateReviewDecision(null)).toThrow(ProposalValidationError)
  })

  it("trims the note", () => {
    const r = validateReviewDecision({
      decision: "rejected",
      note: "   Pricing way too high   ",
    })
    expect(r.note).toBe("Pricing way too high")
  })
})
