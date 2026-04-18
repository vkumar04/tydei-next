import { describe, it, expect } from "vitest"
import {
  computeCaseCompliance,
  summarizeFacilityCompliance,
  type CaseForCompliance,
} from "../compliance"

describe("computeCaseCompliance", () => {
  it("empty → empty array", () => {
    expect(computeCaseCompliance([])).toEqual([])
  })

  it("fully compliant case → 100% compliance", () => {
    const cases: CaseForCompliance[] = [
      {
        caseId: "case-1",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 500 },
          { vendorItemNo: "B", isOnContract: true, extendedCost: 1500 },
        ],
      },
    ]
    const r = computeCaseCompliance(cases)
    expect(r).toHaveLength(1)
    expect(r[0]!.caseId).toBe("case-1")
    expect(r[0]!.compliancePercent).toBe(100)
    expect(r[0]!.onContractSpend).toBe(2000)
    expect(r[0]!.offContractSpend).toBe(0)
    expect(r[0]!.totalSupplySpend).toBe(2000)
    expect(r[0]!.suppliesTotal).toBe(2)
    expect(r[0]!.suppliesOnContract).toBe(2)
  })

  it("zero-compliant case → 0% compliance", () => {
    const cases: CaseForCompliance[] = [
      {
        caseId: "case-1",
        supplies: [
          { vendorItemNo: "A", isOnContract: false, extendedCost: 500 },
          { vendorItemNo: "B", isOnContract: false, extendedCost: 1500 },
        ],
      },
    ]
    const r = computeCaseCompliance(cases)
    expect(r[0]!.compliancePercent).toBe(0)
    expect(r[0]!.onContractSpend).toBe(0)
    expect(r[0]!.offContractSpend).toBe(2000)
    expect(r[0]!.totalSupplySpend).toBe(2000)
    expect(r[0]!.suppliesOnContract).toBe(0)
    expect(r[0]!.suppliesTotal).toBe(2)
  })

  it("partial compliance → correct percentage by dollar-weight", () => {
    const cases: CaseForCompliance[] = [
      {
        caseId: "case-mixed",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 300 },
          { vendorItemNo: "B", isOnContract: true, extendedCost: 200 },
          { vendorItemNo: "C", isOnContract: false, extendedCost: 500 },
        ],
      },
    ]
    const r = computeCaseCompliance(cases)
    expect(r[0]!.onContractSpend).toBe(500)
    expect(r[0]!.offContractSpend).toBe(500)
    expect(r[0]!.totalSupplySpend).toBe(1000)
    expect(r[0]!.compliancePercent).toBe(50)
    expect(r[0]!.suppliesOnContract).toBe(2)
    expect(r[0]!.suppliesTotal).toBe(3)
  })

  it("preserves case order in output", () => {
    const cases: CaseForCompliance[] = [
      {
        caseId: "case-c",
        supplies: [{ vendorItemNo: null, isOnContract: true, extendedCost: 1 }],
      },
      {
        caseId: "case-a",
        supplies: [{ vendorItemNo: null, isOnContract: false, extendedCost: 1 }],
      },
      {
        caseId: "case-b",
        supplies: [{ vendorItemNo: null, isOnContract: true, extendedCost: 1 }],
      },
    ]
    const r = computeCaseCompliance(cases)
    expect(r.map((c) => c.caseId)).toEqual(["case-c", "case-a", "case-b"])
  })

  it("empty supplies array → 0 compliance, no NaN", () => {
    const cases: CaseForCompliance[] = [
      { caseId: "case-empty", supplies: [] },
    ]
    const r = computeCaseCompliance(cases)
    expect(r[0]!.compliancePercent).toBe(0)
    expect(r[0]!.totalSupplySpend).toBe(0)
    expect(r[0]!.suppliesTotal).toBe(0)
    expect(r[0]!.suppliesOnContract).toBe(0)
    expect(Number.isNaN(r[0]!.compliancePercent)).toBe(false)
  })

  it("non-finite extendedCost coerced to 0 (defensive)", () => {
    const cases: CaseForCompliance[] = [
      {
        caseId: "case-bad",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: Number.NaN },
          { vendorItemNo: "B", isOnContract: true, extendedCost: 100 },
        ],
      },
    ]
    const r = computeCaseCompliance(cases)
    expect(r[0]!.onContractSpend).toBe(100)
    expect(r[0]!.totalSupplySpend).toBe(100)
    expect(r[0]!.compliancePercent).toBe(100)
  })

  it("multiple cases computed independently", () => {
    const cases: CaseForCompliance[] = [
      {
        caseId: "case-1",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 100 },
        ],
      },
      {
        caseId: "case-2",
        supplies: [
          { vendorItemNo: "B", isOnContract: false, extendedCost: 400 },
          { vendorItemNo: "C", isOnContract: true, extendedCost: 100 },
        ],
      },
    ]
    const r = computeCaseCompliance(cases)
    expect(r[0]!.compliancePercent).toBe(100)
    expect(r[1]!.compliancePercent).toBe(20)
  })
})

describe("summarizeFacilityCompliance", () => {
  it("empty → all zeros, no low-compliance cases", () => {
    const r = summarizeFacilityCompliance([])
    expect(r.totalSupplySpend).toBe(0)
    expect(r.onContractSpend).toBe(0)
    expect(r.offContractSpend).toBe(0)
    expect(r.compliancePercent).toBe(0)
    expect(r.casesWithLowCompliance).toBe(0)
  })

  it("aggregates spend across multiple case results", () => {
    const results = computeCaseCompliance([
      {
        caseId: "c1",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 800 },
          { vendorItemNo: "B", isOnContract: false, extendedCost: 200 },
        ],
      },
      {
        caseId: "c2",
        supplies: [
          { vendorItemNo: "C", isOnContract: true, extendedCost: 500 },
          { vendorItemNo: "D", isOnContract: false, extendedCost: 500 },
        ],
      },
    ])
    const r = summarizeFacilityCompliance(results)
    expect(r.onContractSpend).toBe(1300)
    expect(r.offContractSpend).toBe(700)
    expect(r.totalSupplySpend).toBe(2000)
    expect(r.compliancePercent).toBe(65)
  })

  it("flags cases with compliance < 80% as low", () => {
    const results = computeCaseCompliance([
      {
        caseId: "hi",
        // 90% compliant — NOT low
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 900 },
          { vendorItemNo: "B", isOnContract: false, extendedCost: 100 },
        ],
      },
      {
        caseId: "borderline",
        // Exactly 80% — NOT low (strict < 80)
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 800 },
          { vendorItemNo: "B", isOnContract: false, extendedCost: 200 },
        ],
      },
      {
        caseId: "lo",
        // 50% compliant — IS low
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 500 },
          { vendorItemNo: "B", isOnContract: false, extendedCost: 500 },
        ],
      },
      {
        caseId: "zero",
        // 0% compliant — IS low
        supplies: [
          { vendorItemNo: "A", isOnContract: false, extendedCost: 1 },
        ],
      },
      {
        caseId: "nospend",
        // totalSupplySpend = 0 → compliancePercent = 0 → counted as low
        supplies: [],
      },
    ])
    const r = summarizeFacilityCompliance(results)
    expect(r.casesWithLowCompliance).toBe(3)
  })

  it("empty cases produce 0 facility compliance without NaN", () => {
    const results = computeCaseCompliance([
      { caseId: "empty-1", supplies: [] },
      { caseId: "empty-2", supplies: [] },
    ])
    const r = summarizeFacilityCompliance(results)
    expect(r.totalSupplySpend).toBe(0)
    expect(r.compliancePercent).toBe(0)
    expect(Number.isNaN(r.compliancePercent)).toBe(false)
    // Both zero-spend cases count as low (0 < 80)
    expect(r.casesWithLowCompliance).toBe(2)
  })

  it("fully compliant facility → 100% compliance, 0 low cases", () => {
    const results = computeCaseCompliance([
      {
        caseId: "c1",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 100 },
        ],
      },
      {
        caseId: "c2",
        supplies: [
          { vendorItemNo: "B", isOnContract: true, extendedCost: 200 },
        ],
      },
    ])
    const r = summarizeFacilityCompliance(results)
    expect(r.compliancePercent).toBe(100)
    expect(r.casesWithLowCompliance).toBe(0)
    expect(r.onContractSpend).toBe(300)
    expect(r.offContractSpend).toBe(0)
  })
})
