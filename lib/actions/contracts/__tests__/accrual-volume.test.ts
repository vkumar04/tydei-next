/**
 * Bug 3 (2026-05-17): volume_rebate contracts need a "Volume (units)"
 * column on the Accrual Timeline so users can see the qty that drove
 * tier achievement. The data layer surfaces per-row `volume` plus a
 * contract-level `isVolumeRebate` flag.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  cogFindManyMock,
  contractFindUniqueMock,
  caseFindManyMock,
} = vi.hoisted(() => ({
  cogFindManyMock: vi.fn(),
  contractFindUniqueMock: vi.fn(),
  caseFindManyMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirstOrThrow: contractFindUniqueMock,
    },
    cOGRecord: {
      findMany: cogFindManyMock,
    },
    case: {
      findMany: caseFindManyMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

import { getAccrualTimeline } from "@/lib/actions/contracts/accrual"

const baseContract = {
  id: "c-1",
  vendorId: "v-1",
  facilityId: "fac-1",
  contractType: "usage",
  effectiveDate: new Date("2025-01-01T00:00:00Z"),
  expirationDate: new Date("2025-06-30T00:00:00Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
  caseFindManyMock.mockResolvedValue([])
})

describe("getAccrualTimeline — volume_rebate column data (Bug 3)", () => {
  it("returns isVolumeRebate=true and per-row volume from COG quantity fallback", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          termType: "volume_rebate",
          termName: "Volume Tier",
          appliesTo: "all_products",
          categories: [],
          cptCodes: [],
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              volumeMin: 0,
              volumeMax: null,
              rebateValue: 10,
              rebateType: "fixed_rebate",
            },
          ],
        },
      ],
    })

    // Two months of COG with explicit quantities.
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 100,
        quantity: 30,
        category: null,
      },
      {
        transactionDate: new Date("2025-02-10T00:00:00Z"),
        extendedPrice: 200,
        quantity: 50,
        category: null,
      },
    ])

    const result = await getAccrualTimeline("c-1")

    expect(
      (result as unknown as { isVolumeRebate: boolean }).isVolumeRebate,
    ).toBe(true)

    type Row = { month: string; volume?: number }
    const rows = result.rows as unknown as Row[]
    const jan = rows.find((r) => r.month === "2025-01")
    const feb = rows.find((r) => r.month === "2025-02")
    expect(jan?.volume).toBe(30)
    expect(feb?.volume).toBe(50)
  })

  it("isVolumeRebate=false for spend-only contracts", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          termType: "spend_rebate",
          termName: "Annual",
          appliesTo: "all_products",
          categories: [],
          cptCodes: [],
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 0.02,
              rebateType: "percent_of_spend",
            },
          ],
        },
      ],
    })
    cogFindManyMock.mockResolvedValue([])
    const result = await getAccrualTimeline("c-1")
    expect(
      (result as unknown as { isVolumeRebate: boolean }).isVolumeRebate,
    ).toBe(false)
  })
})
