import { describe, it, expect } from "vitest"
import {
  allocateRebatesToProcedures,
  calculateMargins,
  type ProcedureSpend,
} from "@/lib/contracts/true-margin"

describe("allocateRebatesToProcedures", () => {
  it("allocates rebates proportional to each procedure's share of vendor spend", () => {
    const procedures: ProcedureSpend[] = [
      { procedureId: "p1", vendorSpend: 20_000 },
      { procedureId: "p2", vendorSpend: 30_000 },
      { procedureId: "p3", vendorSpend: 50_000 },
    ]
    // Total vendor spend $100K, rebate $5K → 5% of each procedure's share.
    const result = allocateRebatesToProcedures(procedures, 100_000, 5_000)
    expect(result.get("p1")).toBe(1_000)
    expect(result.get("p2")).toBe(1_500)
    expect(result.get("p3")).toBe(2_500)
  })

  it("allocates zero when vendor spend is zero", () => {
    const result = allocateRebatesToProcedures(
      [{ procedureId: "p1", vendorSpend: 100 }],
      0,
      5_000,
    )
    expect(result.get("p1")).toBe(0)
  })

  it("allocates zero when rebate is zero", () => {
    const result = allocateRebatesToProcedures(
      [{ procedureId: "p1", vendorSpend: 10 }],
      100,
      0,
    )
    expect(result.get("p1")).toBe(0)
  })

  it("returns empty map for empty procedures", () => {
    const result = allocateRebatesToProcedures([], 100_000, 5_000)
    expect(result.size).toBe(0)
  })
})

describe("calculateMargins", () => {
  it("computes standard and true margin with rebate contribution", () => {
    // Revenue $1,200, costs $800 → standard margin $400 (33.3%)
    // Rebate allocation $100 → true margin $500, contribution $100
    const r = calculateMargins({ revenue: 1_200, costs: 800 }, 100)
    expect(r.standardMargin).toBe(400)
    expect(r.trueMargin).toBe(500)
    expect(r.rebateContribution).toBe(100)
    expect(r.standardMarginPercent).toBeCloseTo(33.33, 1)
    expect(r.trueMarginPercent).toBeCloseTo(41.67, 1)
  })

  it("handles zero revenue as N/A margin percent", () => {
    const r = calculateMargins({ revenue: 0, costs: 0 }, 0)
    expect(r.standardMargin).toBe(0)
    expect(r.trueMargin).toBe(0)
    expect(r.standardMarginPercent).toBeNull()
    expect(r.trueMarginPercent).toBeNull()
  })

  it("negative margin when costs exceed revenue", () => {
    const r = calculateMargins({ revenue: 100, costs: 150 }, 10)
    expect(r.standardMargin).toBe(-50)
    expect(r.trueMargin).toBe(-40)
  })
})
