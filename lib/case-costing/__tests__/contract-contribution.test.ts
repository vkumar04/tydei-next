import { describe, it, expect } from "vitest"
import {
  allocateContractBenefitsToProcedures,
  calculateMarginsV2,
  type AllocateContractBenefitsInput,
  type ProcedureVendorSpend,
  type VendorContractBenefit,
} from "../contract-contribution"

// Floating-point tolerance for proportional-allocation math.
const EPSILON = 1e-9

describe("allocateContractBenefitsToProcedures", () => {
  it("allocates rebates + price reductions across 3 procedures with mixed vendor spend so totals sum to inputs", () => {
    const procedures: ProcedureVendorSpend[] = [
      { procedureId: "proc-A", vendorId: "vendor-1", vendorSpend: 1000 },
      { procedureId: "proc-A", vendorId: "vendor-2", vendorSpend: 500 },
      { procedureId: "proc-B", vendorId: "vendor-1", vendorSpend: 3000 },
      { procedureId: "proc-C", vendorId: "vendor-2", vendorSpend: 1500 },
    ]
    const vendors: VendorContractBenefit[] = [
      {
        vendorId: "vendor-1",
        totalVendorSpend: 4000,
        rebateAmount: 400, // 10% of spend
        priceReductionAmount: 200, // 5% of spend
      },
      {
        vendorId: "vendor-2",
        totalVendorSpend: 2000,
        rebateAmount: 100, // 5% of spend
        priceReductionAmount: 80, // 4% of spend
      },
    ]

    const result = allocateContractBenefitsToProcedures({ procedures, vendors })

    // Per-procedure expectations:
    // proc-A gets vendor-1: 1000/4000 × (400 + 200) = 150
    //         vendor-2:  500/2000 × (100 +  80) = 45
    //         total = 195  (rebate 25% of 400 + 25% of 100 = 125; priceReduction 50 + 20 = 70)
    const procA = result.allocations.get("proc-A")
    expect(procA).toBeDefined()
    expect(procA!.rebateAllocation).toBeCloseTo(100 + 25, 9)
    expect(procA!.priceReductionAllocation).toBeCloseTo(50 + 20, 9)
    expect(procA!.totalContractBenefit).toBeCloseTo(195, 9)

    const procB = result.allocations.get("proc-B")
    expect(procB).toBeDefined()
    expect(procB!.rebateAllocation).toBeCloseTo(300, 9) // 75% of 400
    expect(procB!.priceReductionAllocation).toBeCloseTo(150, 9) // 75% of 200
    expect(procB!.totalContractBenefit).toBeCloseTo(450, 9)

    const procC = result.allocations.get("proc-C")
    expect(procC).toBeDefined()
    expect(procC!.rebateAllocation).toBeCloseTo(75, 9) // 75% of 100
    expect(procC!.priceReductionAllocation).toBeCloseTo(60, 9) // 75% of 80
    expect(procC!.totalContractBenefit).toBeCloseTo(135, 9)

    // Sum checks — rebates.
    const totalRebate = Array.from(result.allocations.values()).reduce(
      (s, a) => s + a.rebateAllocation,
      0,
    )
    expect(totalRebate).toBeCloseTo(400 + 100, 9)

    // Sum checks — price reductions.
    const totalPriceReduction = Array.from(result.allocations.values()).reduce(
      (s, a) => s + a.priceReductionAllocation,
      0,
    )
    expect(totalPriceReduction).toBeCloseTo(200 + 80, 9)

    // Sum checks — totalContractBenefit per-procedure equals rebate + priceReduction per-procedure.
    for (const alloc of result.allocations.values()) {
      expect(alloc.totalContractBenefit).toBeCloseTo(
        alloc.rebateAllocation + alloc.priceReductionAllocation,
        9,
      )
    }
  })

  it("buckets vendorRebateAllocations + vendorPriceReductionAllocations by vendor", () => {
    const input: AllocateContractBenefitsInput = {
      procedures: [
        { procedureId: "proc-A", vendorId: "vendor-1", vendorSpend: 1000 },
        { procedureId: "proc-B", vendorId: "vendor-1", vendorSpend: 3000 },
        { procedureId: "proc-C", vendorId: "vendor-2", vendorSpend: 2000 },
      ],
      vendors: [
        {
          vendorId: "vendor-1",
          totalVendorSpend: 4000,
          rebateAmount: 400,
          priceReductionAmount: 200,
        },
        {
          vendorId: "vendor-2",
          totalVendorSpend: 2000,
          rebateAmount: 100,
          priceReductionAmount: 80,
        },
      ],
    }

    const result = allocateContractBenefitsToProcedures(input)

    expect(result.vendorRebateAllocations.get("vendor-1")).toBeCloseTo(400, 9)
    expect(result.vendorRebateAllocations.get("vendor-2")).toBeCloseTo(100, 9)
    expect(
      result.vendorPriceReductionAllocations.get("vendor-1"),
    ).toBeCloseTo(200, 9)
    expect(
      result.vendorPriceReductionAllocations.get("vendor-2"),
    ).toBeCloseTo(80, 9)
  })

  it("returns zero allocations when vendor spend is zero", () => {
    const input: AllocateContractBenefitsInput = {
      procedures: [
        { procedureId: "proc-A", vendorId: "vendor-1", vendorSpend: 0 },
        { procedureId: "proc-B", vendorId: "vendor-1", vendorSpend: 0 },
      ],
      vendors: [
        {
          vendorId: "vendor-1",
          totalVendorSpend: 0,
          rebateAmount: 400,
          priceReductionAmount: 200,
        },
      ],
    }

    const result = allocateContractBenefitsToProcedures(input)

    expect(result.allocations.get("proc-A")?.rebateAllocation).toBe(0)
    expect(result.allocations.get("proc-A")?.priceReductionAllocation).toBe(0)
    expect(result.allocations.get("proc-A")?.totalContractBenefit).toBe(0)
    expect(result.allocations.get("proc-B")?.rebateAllocation).toBe(0)
    expect(result.allocations.get("proc-B")?.priceReductionAllocation).toBe(0)

    // Vendor roll-ups still exist but are 0.
    expect(result.vendorRebateAllocations.get("vendor-1")).toBe(0)
    expect(result.vendorPriceReductionAllocations.get("vendor-1")).toBe(0)
  })

  it("routes all benefit into priceReductionAllocation when rebate is 0 and price reduction > 0", () => {
    const input: AllocateContractBenefitsInput = {
      procedures: [
        { procedureId: "proc-A", vendorId: "vendor-1", vendorSpend: 1000 },
        { procedureId: "proc-B", vendorId: "vendor-1", vendorSpend: 3000 },
      ],
      vendors: [
        {
          vendorId: "vendor-1",
          totalVendorSpend: 4000,
          rebateAmount: 0,
          priceReductionAmount: 240,
        },
      ],
    }

    const result = allocateContractBenefitsToProcedures(input)

    const procA = result.allocations.get("proc-A")!
    const procB = result.allocations.get("proc-B")!

    expect(procA.rebateAllocation).toBe(0)
    expect(procB.rebateAllocation).toBe(0)
    expect(procA.priceReductionAllocation).toBeCloseTo(60, 9) // 25% of 240
    expect(procB.priceReductionAllocation).toBeCloseTo(180, 9) // 75% of 240
    expect(procA.totalContractBenefit).toBeCloseTo(60, 9)
    expect(procB.totalContractBenefit).toBeCloseTo(180, 9)

    expect(result.vendorRebateAllocations.get("vendor-1")).toBe(0)
    expect(result.vendorPriceReductionAllocations.get("vendor-1")).toBeCloseTo(
      240,
      9,
    )
  })

  it("guarantees totalContractBenefit === rebateAllocation + priceReductionAllocation for every procedure", () => {
    const input: AllocateContractBenefitsInput = {
      procedures: [
        { procedureId: "p1", vendorId: "v1", vendorSpend: 123.45 },
        { procedureId: "p2", vendorId: "v1", vendorSpend: 678.9 },
        { procedureId: "p3", vendorId: "v2", vendorSpend: 55.55 },
      ],
      vendors: [
        {
          vendorId: "v1",
          totalVendorSpend: 802.35,
          rebateAmount: 72.11,
          priceReductionAmount: 31.4,
        },
        {
          vendorId: "v2",
          totalVendorSpend: 55.55,
          rebateAmount: 5,
          priceReductionAmount: 1.23,
        },
      ],
    }

    const result = allocateContractBenefitsToProcedures(input)

    for (const alloc of result.allocations.values()) {
      expect(
        Math.abs(
          alloc.totalContractBenefit -
            (alloc.rebateAllocation + alloc.priceReductionAllocation),
        ),
      ).toBeLessThan(EPSILON)
    }
  })
})

describe("calculateMarginsV2", () => {
  it("computes standard + true margin with both rebate and price reduction factored in", () => {
    const result = calculateMarginsV2(
      { reimbursement: 10000, costs: 7000 },
      {
        rebateAllocation: 400,
        priceReductionAllocation: 200,
      },
    )

    // standardMargin = 10000 - 7000 = 3000
    // trueMargin = 3000 + 600 = 3600
    expect(result.standardMargin).toBe(3000)
    expect(result.trueMargin).toBe(3600)
    expect(result.totalContractBenefit).toBe(600)
    expect(result.rebateContribution).toBe(400)
    expect(result.priceReductionContribution).toBe(200)
    expect(result.standardMarginPercent).toBeCloseTo(30, 9)
    expect(result.trueMarginPercent).toBeCloseTo(36, 9)
  })

  it("[A9] returns 0 percent margins when reimbursement is 0 (no NaN, no Infinity)", () => {
    const result = calculateMarginsV2(
      { reimbursement: 0, costs: 5000 },
      { rebateAllocation: 100, priceReductionAllocation: 50 },
    )

    expect(result.standardMargin).toBe(-5000)
    expect(result.trueMargin).toBe(-5000 + 150)
    expect(result.standardMarginPercent).toBe(0)
    expect(result.trueMarginPercent).toBe(0)
    expect(Number.isNaN(result.standardMarginPercent)).toBe(false)
    expect(Number.isFinite(result.standardMarginPercent)).toBe(true)
    expect(Number.isNaN(result.trueMarginPercent)).toBe(false)
    expect(Number.isFinite(result.trueMarginPercent)).toBe(true)
  })

  it("[A9] returns 0 percent margins when revenue rounds to 0 via negative reimbursement guard", () => {
    // Defensive: a zeroed case with zero costs must still produce 0 percents.
    const result = calculateMarginsV2(
      { reimbursement: 0, costs: 0 },
      { rebateAllocation: 0, priceReductionAllocation: 0 },
    )
    expect(result.standardMargin).toBe(0)
    expect(result.trueMargin).toBe(0)
    expect(result.standardMarginPercent).toBe(0)
    expect(result.trueMarginPercent).toBe(0)
  })

  it("honours an explicit totalContractBenefit pass-through when the caller supplies one", () => {
    const result = calculateMarginsV2(
      { reimbursement: 1000, costs: 800 },
      {
        rebateAllocation: 10,
        priceReductionAllocation: 20,
        totalContractBenefit: 50, // caller-supplied override
      },
    )
    expect(result.totalContractBenefit).toBe(50)
    expect(result.trueMargin).toBe(200 + 50)
  })

  it("treats negative rebate / price-reduction inputs as 0 (defensive)", () => {
    const result = calculateMarginsV2(
      { reimbursement: 1000, costs: 500 },
      { rebateAllocation: -50, priceReductionAllocation: -25 },
    )
    expect(result.rebateContribution).toBe(0)
    expect(result.priceReductionContribution).toBe(0)
    expect(result.totalContractBenefit).toBe(0)
    expect(result.trueMargin).toBe(500)
  })
})
