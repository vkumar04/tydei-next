/**
 * Parity test for refresh-metrics — strategic-direction Plan #1.
 *
 * The action must write back EXACTLY what computeContractMetrics
 * returns (within rounding); any drift between the two means a future
 * "the number doesn't match" PO bug.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "f1" },
    user: { id: "u1" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string, facilityId: string) => ({
    id,
    facilityId,
  }),
}))

const findFirstOrThrow = vi.fn()
const update = vi.fn(async () => ({}))
vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirstOrThrow,
      update,
      findMany: vi.fn(async () => []),
    },
  },
}))

const computeContractMetricsMock = vi.fn()
vi.mock("@/lib/actions/contracts/derived-metrics", () => ({
  computeContractMetrics: computeContractMetricsMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.resetModules()
})

describe("refreshContractMetrics", () => {
  it("writes computeContractMetrics output back to the contract", async () => {
    findFirstOrThrow.mockResolvedValue({
      id: "c1",
      totalValue: 600_000,
      annualValue: null,
      effectiveDate: new Date("2024-01-01"),
      expirationDate: new Date("2026-12-31"),
      complianceRate: null,
      currentMarketShare: null,
    })
    computeContractMetricsMock.mockResolvedValue({
      complianceRate: 87.5,
      currentMarketShare: 42.0,
      cogRowsTotal: 100,
      cogRowsOnContract: 87,
      vendorSpendInCategories: 420_000,
      totalSpendInCategories: 1_000_000,
      windowStart: "2024-01-01T00:00:00.000Z",
      windowEnd: "2024-12-31T00:00:00.000Z",
    })

    const { refreshContractMetrics } = await import("../refresh-metrics")
    const result = await refreshContractMetrics("c1")

    expect(result.complianceRate).toBe(87.5)
    expect(result.currentMarketShare).toBe(42.0)
    expect(result.changed).toBe(true)
    // 600K / 3 years (calendar math via 365.25 days) ≈ 200K.
    expect(result.annualValue).toBeGreaterThanOrEqual(199_000)
    expect(result.annualValue).toBeLessThanOrEqual(201_000)

    expect(update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({
        complianceRate: 87.5,
        currentMarketShare: 42.0,
      }),
    })
  })

  it("preserves non-uniform annualValue when within 25% of derived", async () => {
    // Total $1M over 3 years = derived annual $333K.
    // Stored $400K is +20%, within band — preserve.
    findFirstOrThrow.mockResolvedValue({
      id: "c1",
      totalValue: 1_000_000,
      annualValue: 400_000,
      effectiveDate: new Date("2024-01-01"),
      expirationDate: new Date("2026-12-31"),
      complianceRate: 80,
      currentMarketShare: 30,
    })
    computeContractMetricsMock.mockResolvedValue({
      complianceRate: 80,
      currentMarketShare: 30,
      cogRowsTotal: 1,
      cogRowsOnContract: 1,
      vendorSpendInCategories: 0,
      totalSpendInCategories: 0,
      windowStart: "x",
      windowEnd: "y",
    })

    const { refreshContractMetrics } = await import("../refresh-metrics")
    const result = await refreshContractMetrics("c1")

    expect(result.annualValue).toBe(400_000)
    // Nothing changed — no update.
    expect(result.changed).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it("overwrites annualValue when stored value drifts >25% from derived", async () => {
    // $1M / 3 = $333K derived. Stored $800K = +140% — way past 25% band.
    findFirstOrThrow.mockResolvedValue({
      id: "c1",
      totalValue: 1_000_000,
      annualValue: 800_000,
      effectiveDate: new Date("2024-01-01"),
      expirationDate: new Date("2026-12-31"),
      complianceRate: null,
      currentMarketShare: null,
    })
    computeContractMetricsMock.mockResolvedValue({
      complianceRate: null,
      currentMarketShare: null,
      cogRowsTotal: 0,
      cogRowsOnContract: 0,
      vendorSpendInCategories: 0,
      totalSpendInCategories: 0,
      windowStart: "x",
      windowEnd: "y",
    })

    const { refreshContractMetrics } = await import("../refresh-metrics")
    const result = await refreshContractMetrics("c1")

    expect(result.annualValue).toBeGreaterThanOrEqual(332_000)
    expect(result.annualValue).toBeLessThanOrEqual(334_000)
    expect(result.changed).toBe(true)
  })

  it("handles totalValue = 0 (no derivation possible) without crashing", async () => {
    findFirstOrThrow.mockResolvedValue({
      id: "c1",
      totalValue: 0,
      annualValue: null,
      effectiveDate: new Date("2024-01-01"),
      expirationDate: new Date("2026-12-31"),
      complianceRate: null,
      currentMarketShare: null,
    })
    computeContractMetricsMock.mockResolvedValue({
      complianceRate: null,
      currentMarketShare: null,
      cogRowsTotal: 0,
      cogRowsOnContract: 0,
      vendorSpendInCategories: 0,
      totalSpendInCategories: 0,
      windowStart: "x",
      windowEnd: "y",
    })

    const { refreshContractMetrics } = await import("../refresh-metrics")
    const result = await refreshContractMetrics("c1")

    expect(result.annualValue).toBe(null)
    expect(result.complianceRate).toBe(null)
  })
})
