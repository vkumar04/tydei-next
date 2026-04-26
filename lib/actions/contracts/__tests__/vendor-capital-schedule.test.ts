import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyRebateMock: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findFirst: mocks.findFirstMock },
    rebate: { findMany: mocks.findManyRebateMock },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: vi.fn(async () => ({
    vendor: { id: "v-test", name: "Test Vendor" },
    user: { id: "u-1" },
  })),
}))

const { findFirstMock, findManyRebateMock } = mocks

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T): T => x,
}))

import { getVendorContractCapitalSchedule } from "@/lib/actions/contracts/tie-in"

describe("getVendorContractCapitalSchedule (Charles audit suggestion #3)", () => {
  beforeEach(() => {
    findFirstMock.mockReset()
    findManyRebateMock.mockReset().mockResolvedValue([])
  })

  it("returns the schedule when the vendor owns the contract", async () => {
    findFirstMock.mockResolvedValue({
      id: "c-1",
      name: "Test Tie-In",
      contractType: "tie_in",
      vendorId: "v-test",
      facilityId: "f-1",
      effectiveDate: new Date("2025-01-01"),
      amortizationShape: "symmetrical",
      amortizationRows: [],
      // Charles audit suggestion #4 (v0-port): capital lives in line
      // items only (legacy contract-level fields were removed).
      capitalLineItems: [
        {
          id: "li-1",
          contractId: "c-1",
          description: "Test Equipment",
          itemNumber: null,
          serialNumber: null,
          contractTotal: 100000,
          initialSales: 20000,
          interestRate: 0.05,
          termMonths: 60,
          paymentType: "fixed",
          paymentCadence: "monthly",
        },
      ],
      rebates: [],
    })

    const result = await getVendorContractCapitalSchedule("c-1")

    expect(result.hasSchedule).toBe(true)
    expect(result.capitalCost).toBe(100000)
    expect(result.downPayment).toBe(20000)
    expect(result.financedPrincipal).toBe(80000)
    expect(result.schedule.length).toBe(60)
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-1", vendorId: "v-test" },
      }),
    )
  })

  it("returns the empty shape (hasSchedule=false) for a contract not owned by the vendor", async () => {
    // Foreign-vendor lookup returns null because the {vendorId} filter
    // excludes the row.
    findFirstMock.mockResolvedValue(null)

    const result = await getVendorContractCapitalSchedule("c-foreign")
    expect(result.hasSchedule).toBe(false)
    expect(result.capitalCost).toBe(0)
    expect(result.schedule).toEqual([])
  })
})
