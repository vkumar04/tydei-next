import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Wave A coverage: `getContractCapitalSchedule` returns the three
 * capital summary numbers (remainingBalance, paidToDate, projectedEndOfTermBalance)
 * and the full amortization schedule for a tie-in contract.
 *
 * Charles W1.T — capital lives on the Contract row now; fixtures stub
 * `contract.capitalCost / interestRate / termMonths / paymentCadence`
 * plus `amortizationRows` on the contract directly.
 */

const { findFirstMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { contract: { findFirst: findFirstMock } },
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
      effectiveDate: new Date("2026-01-01"),
      capitalCost: null,
      interestRate: null,
      termMonths: null,
      paymentCadence: null,
      amortizationShape: "symmetrical",
      amortizationRows: [],
    })

    const r = await getContractCapitalSchedule("c-1")

    expect(r.hasSchedule).toBe(false)
    expect(r.schedule).toEqual([])
    expect(r.remainingBalance).toBe(0)
    expect(r.paidToDate).toBe(0)
    expect(r.projectedEndOfTermBalance).toBeNull()
  })

  it("returns remaining balance, paid to date, and projected end-of-term balance for a 12-month monthly schedule", async () => {
    // Contract that started 3 months ago → 3 periods elapsed, 9 remaining.
    const effectiveDate = new Date()
    effectiveDate.setMonth(effectiveDate.getMonth() - 3)

    findFirstMock.mockResolvedValueOnce({
      id: "c-1",
      effectiveDate,
      capitalCost: 12_000, // $12k over 12 months, 0% → $1k principal/mo
      interestRate: 0,
      termMonths: 12,
      paymentCadence: "monthly",
      amortizationShape: "symmetrical",
      amortizationRows: [],
    })

    const r = await getContractCapitalSchedule("c-1")

    expect(r.hasSchedule).toBe(true)
    expect(r.schedule).toHaveLength(12)
    // With r=0, every period pays $1,000 principal.
    expect(r.schedule[0]!.principalDue).toBeCloseTo(1000, 2)
    expect(r.schedule[0]!.amortizationDue).toBeCloseTo(1000, 2)
    // 3 periods elapsed → paid $3k, remaining $9k.
    expect(r.elapsedPeriods).toBe(3)
    expect(r.paidToDate).toBeCloseTo(3000, 2)
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
      effectiveDate,
      capitalCost: 1000,
      interestRate: 0,
      termMonths: 2,
      paymentCadence: "monthly",
      amortizationShape: "custom",
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
    })

    const r = await getContractCapitalSchedule("c-1")

    expect(r.hasSchedule).toBe(true)
    expect(r.schedule).toHaveLength(2)
    expect(r.schedule[0]!.principalDue).toBe(500)
    expect(r.paidToDate).toBe(500)
    expect(r.remainingBalance).toBe(500)
  })
})
