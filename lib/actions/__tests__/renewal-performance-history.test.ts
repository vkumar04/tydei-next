/**
 * Tests for the renewals performance-history server action (W1.1).
 *
 * Guards two cases:
 *   1. ContractPeriod rows present → aggregated rows returned.
 *   2. Zero rows → `[]`, so the detail modal renders the "insufficient
 *      history" empty state instead of synthesizing numbers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { findManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contractPeriod: {
      findMany: findManyMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "u-1" } }),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T>(x: T) => x,
}))

import { getContractPerformanceHistory } from "@/lib/actions/renewals"

describe("getContractPerformanceHistory", () => {
  beforeEach(() => {
    findManyMock.mockReset()
  })

  it("returns [] when the contract has no ContractPeriod rows", async () => {
    findManyMock.mockResolvedValue([])
    const rows = await getContractPerformanceHistory("c-empty")
    expect(rows).toEqual([])
  })

  it("aggregates ContractPeriod rows into one row per year", async () => {
    findManyMock.mockResolvedValue([
      {
        periodStart: new Date("2024-01-01T00:00:00Z"),
        periodEnd: new Date("2024-06-30T00:00:00Z"),
        totalSpend: 400_000,
        rebateEarned: 15_000,
      },
      {
        periodStart: new Date("2024-07-01T00:00:00Z"),
        periodEnd: new Date("2024-12-31T00:00:00Z"),
        totalSpend: 600_000,
        rebateEarned: 25_000,
      },
      {
        periodStart: new Date("2025-01-01T00:00:00Z"),
        periodEnd: new Date("2025-06-30T00:00:00Z"),
        totalSpend: 550_000,
        rebateEarned: 22_000,
      },
    ])

    const rows = await getContractPerformanceHistory("c-ok")
    expect(rows).toEqual([
      { year: 2024, spend: 1_000_000, rebate: 40_000, compliance: null },
      { year: 2025, spend: 550_000, rebate: 22_000, compliance: null },
    ])
  })
})
