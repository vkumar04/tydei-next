import { describe, it, expect } from "vitest"
import {
  computePayorMix,
  type CaseWithPayor,
  type PayorType,
} from "../payor-mix"

const EPSILON = 1e-9

describe("computePayorMix", () => {
  it("empty cases → all zeros, no classified cases, no null cases", () => {
    const r = computePayorMix([])
    expect(r.totalCases).toBe(0)
    expect(r.totalReimbursement).toBe(0)
    expect(r.casesWithoutPayor).toBe(0)
    // Every key should be pre-initialized to 0
    expect(r.shares.commercial).toBe(0)
    expect(r.shares.medicare).toBe(0)
    expect(r.shares.medicaid).toBe(0)
    expect(r.shares.private).toBe(0)
    expect(r.shares.workers_comp).toBe(0)
    expect(r.shares.other).toBe(0)
    expect(r.reimbursementByPayor.commercial).toBe(0)
    expect(r.reimbursementByPayor.medicare).toBe(0)
    expect(r.reimbursementByPayor.medicaid).toBe(0)
    expect(r.reimbursementByPayor.private).toBe(0)
    expect(r.reimbursementByPayor.workers_comp).toBe(0)
    expect(r.reimbursementByPayor.other).toBe(0)
  })

  it("single-payor → 100% share on that payor, 0 on all others", () => {
    const cases: CaseWithPayor[] = [
      { payorType: "commercial", totalReimbursement: 5000 },
      { payorType: "commercial", totalReimbursement: 3000 },
    ]
    const r = computePayorMix(cases)
    expect(r.totalCases).toBe(2)
    expect(r.casesWithoutPayor).toBe(0)
    expect(r.shares.commercial).toBe(1)
    expect(r.shares.medicare).toBe(0)
    expect(r.shares.medicaid).toBe(0)
    expect(r.shares.private).toBe(0)
    expect(r.shares.workers_comp).toBe(0)
    expect(r.shares.other).toBe(0)
    expect(r.reimbursementByPayor.commercial).toBe(8000)
    expect(r.totalReimbursement).toBe(8000)
  })

  it("multi-payor shares sum to 1 across classified cases", () => {
    const cases: CaseWithPayor[] = [
      { payorType: "commercial", totalReimbursement: 1000 },
      { payorType: "commercial", totalReimbursement: 2000 },
      { payorType: "medicare", totalReimbursement: 500 },
      { payorType: "medicaid", totalReimbursement: 100 },
      { payorType: "workers_comp", totalReimbursement: 200 },
    ]
    const r = computePayorMix(cases)
    const sumShares =
      r.shares.commercial +
      r.shares.medicare +
      r.shares.medicaid +
      r.shares.private +
      r.shares.workers_comp +
      r.shares.other
    expect(Math.abs(sumShares - 1)).toBeLessThan(EPSILON)
    expect(r.shares.commercial).toBeCloseTo(2 / 5, 10)
    expect(r.shares.medicare).toBeCloseTo(1 / 5, 10)
    expect(r.shares.medicaid).toBeCloseTo(1 / 5, 10)
    expect(r.shares.workers_comp).toBeCloseTo(1 / 5, 10)
    expect(r.shares.private).toBe(0)
    expect(r.shares.other).toBe(0)
  })

  it("null-payor cases counted separately via casesWithoutPayor and NOT in share denominator", () => {
    const cases: CaseWithPayor[] = [
      { payorType: "commercial", totalReimbursement: 1000 },
      { payorType: null, totalReimbursement: 200 },
      { payorType: null, totalReimbursement: 300 },
    ]
    const r = computePayorMix(cases)
    expect(r.totalCases).toBe(3)
    expect(r.casesWithoutPayor).toBe(2)
    // Denominator excludes null-payor: only 1 classified case → 100% commercial
    expect(r.shares.commercial).toBe(1)
    expect(r.shares.medicare).toBe(0)
    // Null-payor reimbursement still counted in totalReimbursement
    expect(r.totalReimbursement).toBe(1500)
    // But NOT in any payor bucket
    expect(r.reimbursementByPayor.commercial).toBe(1000)
  })

  it("zero reimbursement cases → safe (no NaN), still counted in shares", () => {
    const cases: CaseWithPayor[] = [
      { payorType: "medicare", totalReimbursement: 0 },
      { payorType: "medicare", totalReimbursement: 0 },
    ]
    const r = computePayorMix(cases)
    expect(r.totalReimbursement).toBe(0)
    expect(r.shares.medicare).toBe(1)
    expect(r.reimbursementByPayor.medicare).toBe(0)
    expect(Number.isNaN(r.shares.medicare)).toBe(false)
  })

  it("all-null cases → all shares 0, casesWithoutPayor equals totalCases", () => {
    const cases: CaseWithPayor[] = [
      { payorType: null, totalReimbursement: 100 },
      { payorType: null, totalReimbursement: 200 },
    ]
    const r = computePayorMix(cases)
    expect(r.totalCases).toBe(2)
    expect(r.casesWithoutPayor).toBe(2)
    expect(r.totalReimbursement).toBe(300)
    // No classified cases → every share is 0 (not NaN)
    const payors: PayorType[] = [
      "commercial",
      "medicare",
      "medicaid",
      "private",
      "workers_comp",
      "other",
    ]
    for (const p of payors) {
      expect(r.shares[p]).toBe(0)
      expect(r.reimbursementByPayor[p]).toBe(0)
      expect(Number.isNaN(r.shares[p])).toBe(false)
    }
  })

  it("reimbursement per payor sums correctly across multiple cases of same type", () => {
    const cases: CaseWithPayor[] = [
      { payorType: "private", totalReimbursement: 100 },
      { payorType: "private", totalReimbursement: 250 },
      { payorType: "other", totalReimbursement: 50 },
    ]
    const r = computePayorMix(cases)
    expect(r.reimbursementByPayor.private).toBe(350)
    expect(r.reimbursementByPayor.other).toBe(50)
    expect(r.totalReimbursement).toBe(400)
  })

  it("every PayorType key is pre-initialized so callers never hit undefined", () => {
    const cases: CaseWithPayor[] = [
      { payorType: "commercial", totalReimbursement: 1 },
    ]
    const r = computePayorMix(cases)
    // Hasown-level check: ensure keys exist even when payor type absent from input
    expect(Object.keys(r.shares).sort()).toEqual(
      [
        "commercial",
        "medicaid",
        "medicare",
        "other",
        "private",
        "workers_comp",
      ].sort(),
    )
    expect(Object.keys(r.reimbursementByPayor).sort()).toEqual(
      [
        "commercial",
        "medicaid",
        "medicare",
        "other",
        "private",
        "workers_comp",
      ].sort(),
    )
  })

  it("non-finite reimbursement coerced to 0 (defensive against bad inputs)", () => {
    const cases: CaseWithPayor[] = [
      { payorType: "commercial", totalReimbursement: Number.NaN },
      { payorType: "commercial", totalReimbursement: 100 },
    ]
    const r = computePayorMix(cases)
    expect(r.totalReimbursement).toBe(100)
    expect(r.reimbursementByPayor.commercial).toBe(100)
    expect(Number.isNaN(r.totalReimbursement)).toBe(false)
  })
})
