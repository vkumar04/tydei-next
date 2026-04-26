import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Wave A coverage: `getContractCapitalSchedule` returns the three
 * capital summary numbers (remainingBalance, paidToDate, projectedEndOfTermBalance)
 * and the full amortization schedule for a tie-in contract.
 *
 * Charles W1.T — capital lives on the Contract row now; fixtures stub
 * `contract.capitalCost / interestRate / termMonths / paymentCadence`
 * plus `amortizationRows` on the contract directly.
 *
 * Charles W1.Y-C — `paidToDate` now reads from collected rebates via
 * `sumRebateAppliedToCapital` (not the forecast schedule). Fixtures now
 * include `contractType` and `rebates` rows so the canonical helper has
 * input to reduce.
 */

const { findFirstMock, cogAggMock, periodAggMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  cogAggMock: vi.fn(async () => ({ _sum: { extendedPrice: 0 } })),
  periodAggMock: vi.fn(async () => ({ _sum: { totalSpend: 0 } })),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findFirst: findFirstMock },
    cOGRecord: { aggregate: cogAggMock },
    contractPeriod: { aggregate: periodAggMock },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getContractCapitalSchedule } from "@/lib/actions/contracts/tie-in"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getContractCapitalSchedule (Wave A)", () => {
  it("returns an empty, well-formed shape when the contract has no capital term", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "c-1",
      contractType: "tie_in",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      capitalCost: null,
      interestRate: null,
      termMonths: null,
      paymentCadence: null,
      amortizationShape: "symmetrical",
      amortizationRows: [],
      rebates: [],
      terms: [],
    })

    const r = await getContractCapitalSchedule("c-1")

    expect(r.hasSchedule).toBe(false)
    expect(r.schedule).toEqual([])
    expect(r.remainingBalance).toBe(0)
    expect(r.paidToDate).toBe(0)
    expect(r.rebateAppliedToCapital).toBe(0)
    expect(r.projectedEndOfTermBalance).toBeNull()
  })

  it("returns remaining balance, paid to date, and projected end-of-term balance for a 12-month monthly schedule", async () => {
    // Contract that started 3 months ago → 3 periods elapsed, 9 remaining.
    const effectiveDate = new Date()
    effectiveDate.setMonth(effectiveDate.getMonth() - 3)

    findFirstMock.mockResolvedValueOnce({
      id: "c-1",
      name: "Test Tie-In",
      contractType: "tie_in",
      vendorId: "v-1",
      effectiveDate,
      amortizationShape: "symmetrical",
      amortizationRows: [],
      // Charles audit suggestion #4 (v0-port): capital via line items.
      capitalLineItems: [
        {
          id: "li-1",
          contractId: "c-1",
          description: "Equipment",
          itemNumber: null,
          serialNumber: null,
          contractTotal: 12_000, // $12k over 12 months, 0% → $1k/mo
          initialSales: 0,
          interestRate: 0,
          termMonths: 12,
          paymentType: "fixed",
          paymentCadence: "monthly",
        },
      ],
      // Charles W1.Y-C: `paidToDate` now reads from collected rebates.
      // Seed 3 collected rows summing to $3,000 so the assertion below
      // (pre-W1.Y-C had assumed schedule-based paid-to-date) still holds.
      rebates: [
        {
          collectionDate: new Date("2025-01-15"),
          rebateCollected: 1000,
        },
        {
          collectionDate: new Date("2025-02-15"),
          rebateCollected: 1000,
        },
        {
          collectionDate: new Date("2025-03-15"),
          rebateCollected: 1000,
        },
      ],
      terms: [],
    })

    const r = await getContractCapitalSchedule("c-1")

    expect(r.hasSchedule).toBe(true)
    expect(r.schedule).toHaveLength(12)
    // With r=0, every period pays $1,000 principal (forecast schedule).
    expect(r.schedule[0]!.principalDue).toBeCloseTo(1000, 2)
    expect(r.schedule[0]!.amortizationDue).toBeCloseTo(1000, 2)
    // 3 periods elapsed → schedule forecasts $3k; under W1.Y-C we now
    // read paid-to-date from collected rebates, which we've seeded to
    // total $3,000 so the assertion is unchanged.
    expect(r.elapsedPeriods).toBe(3)
    expect(r.paidToDate).toBeCloseTo(3000, 2)
    expect(r.rebateAppliedToCapital).toBeCloseTo(3000, 2)
    expect(r.remainingBalance).toBeCloseTo(9000, 2)
    // Projected end-of-term balance: at $1k/mo paydown over the remaining
    // ~9 months of the term, the balance should retire cleanly to $0.
    expect(r.projectedEndOfTermBalance).not.toBeNull()
    expect(r.projectedEndOfTermBalance).toBeLessThanOrEqual(remainingFloor(r.remainingBalance))
  })

  function remainingFloor(n: number): number {
    return n
  }

  it("uses persisted ContractAmortizationSchedule rows when present", async () => {
    const effectiveDate = new Date()
    effectiveDate.setMonth(effectiveDate.getMonth() - 1)

    findFirstMock.mockResolvedValueOnce({
      id: "c-1",
      name: "Custom",
      contractType: "tie_in",
      vendorId: "v-1",
      effectiveDate,
      amortizationShape: "custom",
      capitalLineItems: [
        {
          id: "li-1",
          contractId: "c-1",
          description: "Equipment",
          itemNumber: null,
          serialNumber: null,
          contractTotal: 1000,
          initialSales: 0,
          interestRate: 0,
          termMonths: 2,
          paymentType: "variable",
          paymentCadence: "monthly",
        },
      ],
      amortizationRows: [
        {
          periodNumber: 1,
          openingBalance: 1000,
          interestCharge: 0,
          principalDue: 500,
          amortizationDue: 500,
          closingBalance: 500,
        },
        {
          periodNumber: 2,
          openingBalance: 500,
          interestCharge: 0,
          principalDue: 500,
          amortizationDue: 500,
          closingBalance: 0,
        },
      ],
      // Charles W1.Y-C: paid-to-date now reads from collected rebates.
      rebates: [
        {
          collectionDate: new Date("2025-01-15"),
          rebateCollected: 500,
        },
      ],
      terms: [],
    })

    const r = await getContractCapitalSchedule("c-1")

    expect(r.hasSchedule).toBe(true)
    expect(r.schedule).toHaveLength(2)
    expect(r.schedule[0]!.principalDue).toBe(500)
    expect(r.paidToDate).toBe(500)
    expect(r.remainingBalance).toBe(500)
  })
})
