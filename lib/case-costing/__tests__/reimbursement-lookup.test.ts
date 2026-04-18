import { describe, it, expect } from "vitest"
import {
  lookupReimbursement,
  bulkLookupReimbursement,
  type PayorCptRate,
  type CaseForReimbursement,
} from "../reimbursement-lookup"

const rates: PayorCptRate[] = [
  {
    payorType: "commercial",
    cptCode: "29881",
    reimbursement: 3500,
    effectiveFrom: new Date("2026-01-01"),
  },
  {
    payorType: "medicare",
    cptCode: "29881",
    reimbursement: 2200,
    effectiveFrom: new Date("2026-01-01"),
  },
  {
    payorType: "commercial",
    cptCode: "27447",
    reimbursement: 12_000,
    effectiveFrom: new Date("2026-01-01"),
  },
  {
    payorType: "medicare",
    cptCode: "default",
    reimbursement: 1500,
    effectiveFrom: new Date("2026-01-01"),
  },
]

const caseRec = (overrides: Partial<CaseForReimbursement>): CaseForReimbursement => ({
  primaryCptCode: "29881",
  payorType: "commercial",
  dateOfSurgery: new Date("2026-06-15"),
  ...overrides,
})

describe("lookupReimbursement", () => {
  it("exact (payor, cpt) match wins", () => {
    const r = lookupReimbursement(caseRec({}), rates)
    expect(r.source).toBe("exact")
    expect(r.reimbursement).toBe(3500)
  })

  it("falls back to cpt-only when payor doesn't match", () => {
    const r = lookupReimbursement(
      caseRec({ payorType: "workers_comp" }),
      rates,
    )
    expect(r.source).toBe("cpt_only")
    expect(r.reimbursement).toBe(3500) // commercial 29881 wins
  })

  it("falls back to payor-only when CPT doesn't match", () => {
    const r = lookupReimbursement(
      caseRec({ primaryCptCode: "99999" }),
      rates,
    )
    expect(r.source).toBe("payor_only")
    expect(r.reimbursement).toBe(3500) // commercial 29881 only commercial entry matches
  })

  it("returns not_found when nothing matches", () => {
    const r = lookupReimbursement(
      caseRec({
        primaryCptCode: "99999",
        payorType: "workers_comp",
      }),
      rates,
    )
    expect(r.source).toBe("not_found")
    expect(r.reimbursement).toBe(0)
    expect(r.matchedRate).toBeNull()
  })

  it("skips rates outside the effective window", () => {
    const lateRate: PayorCptRate = {
      payorType: "commercial",
      cptCode: "29881",
      reimbursement: 5000,
      effectiveFrom: new Date("2027-01-01"), // future
    }
    const r = lookupReimbursement(caseRec({}), [lateRate])
    expect(r.source).toBe("not_found")
  })

  it("picks most recent rate when multiple match", () => {
    const multi: PayorCptRate[] = [
      {
        payorType: "commercial",
        cptCode: "29881",
        reimbursement: 3000,
        effectiveFrom: new Date("2025-01-01"),
      },
      {
        payorType: "commercial",
        cptCode: "29881",
        reimbursement: 3500,
        effectiveFrom: new Date("2026-01-01"),
      },
    ]
    const r = lookupReimbursement(caseRec({}), multi)
    expect(r.reimbursement).toBe(3500)
  })

  it("null primaryCptCode skips CPT-based passes", () => {
    const r = lookupReimbursement(
      caseRec({ primaryCptCode: null }),
      rates,
    )
    // Falls through to payor-only; first commercial rate matches
    expect(r.source).toBe("payor_only")
  })

  it("null payorType skips payor-based passes", () => {
    const r = lookupReimbursement(
      caseRec({ payorType: null, primaryCptCode: "27447" }),
      rates,
    )
    expect(r.source).toBe("cpt_only")
    expect(r.reimbursement).toBe(12_000)
  })

  it("both null → not_found", () => {
    const r = lookupReimbursement(
      caseRec({ payorType: null, primaryCptCode: null }),
      rates,
    )
    expect(r.source).toBe("not_found")
  })

  it("matchedRate returned with full rate object on match", () => {
    const r = lookupReimbursement(caseRec({}), rates)
    expect(r.matchedRate?.payorType).toBe("commercial")
    expect(r.matchedRate?.cptCode).toBe("29881")
  })
})

describe("bulkLookupReimbursement", () => {
  it("resolves each case via single rate table", () => {
    const cases = [
      {
        id: "c1",
        primaryCptCode: "29881",
        payorType: "commercial",
        dateOfSurgery: new Date("2026-06-15"),
      },
      {
        id: "c2",
        primaryCptCode: "27447",
        payorType: "commercial",
        dateOfSurgery: new Date("2026-06-15"),
      },
      {
        id: "c3",
        primaryCptCode: "99999",
        payorType: "workers_comp",
        dateOfSurgery: new Date("2026-06-15"),
      },
    ]
    const map = bulkLookupReimbursement(cases, rates)
    expect(map["c1"].reimbursement).toBe(3500)
    expect(map["c2"].reimbursement).toBe(12_000)
    expect(map["c3"].source).toBe("not_found")
  })

  it("empty cases → empty map", () => {
    expect(bulkLookupReimbursement([], rates)).toEqual({})
  })
})
