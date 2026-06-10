/**
 * Compliance-unification parity test (2026-06-09 audit carry-over).
 *
 * Vendor surfaces used to show up to THREE different compliance values
 * for the same vendor:
 *   - `getVendorPerformance` (vendor-analytics) capped at 100,
 *   - `getVendorPerformanceContracts` (vendor-analytics) capped at 120,
 *   - `getVendorPerformanceSummary` (vendor-reports) averaged the
 *     persisted `Contract.complianceRate` — a match-compliance metric
 *     measuring something else entirely.
 *
 * All three now route through `computeVendorCompliance` /
 * `computeContractCompliance` (lib/contracts/vendor-compliance.ts).
 * This test feeds the SAME world (one active contract, annual target
 * $10,000, trailing-12mo vendor COG spend $5,000 at one facility)
 * through every call path and asserts the identical value comes out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mutable fixtures the prisma mock reads from.
let annualValue = 10000
let cogSpend12Mo = 5000

const contractRow = () => ({
  id: "c-1",
  name: "Joint Replacement",
  status: "active",
  facilityId: "f-1",
  facility: { id: "f-1", name: "Lighthouse Surgical Center" },
  annualValue,
  totalValue: 30000, // decoy: annualValue must win (annualValue || totalValue)
  currentMarketShare: null,
  periods: [] as Array<{ totalSpend: number }>,
  rebates: [] as Array<{
    rebateEarned: number
    rebateCollected: number
    payPeriodEnd: Date | null
    collectionDate: Date | null
  }>,
})

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      count: vi.fn(async () => 1),
      groupBy: vi.fn(async () => [{ facilityId: "f-1" }]),
      findMany: vi.fn(async () => [contractRow()]),
    },
    cOGRecord: {
      aggregate: vi.fn(async () => ({
        _sum: { extendedPrice: cogSpend12Mo },
      })),
      groupBy: vi.fn(async (args: { by: string[] }) =>
        args.by.includes("facilityId")
          ? [{ facilityId: "f-1", _sum: { extendedPrice: cogSpend12Mo } }]
          : [{ contractId: "c-1", _sum: { extendedPrice: cogSpend12Mo } }],
      ),
    },
    rebate: {
      findMany: vi.fn(async () => []),
    },
    categoryMapping: {
      findMany: vi.fn(async () => []),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: vi.fn(async () => ({
    vendor: { id: "v-1" },
    user: { id: "u-1" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

beforeEach(() => {
  vi.clearAllMocks()
  annualValue = 10000
  cogSpend12Mo = 5000
})

async function complianceThroughEveryPath(): Promise<{
  performance: number | null
  perContract: number
  summary: number
}> {
  const { getVendorPerformance, getVendorPerformanceContracts } = await import(
    "@/lib/actions/vendor-analytics"
  )
  const { getVendorPerformanceSummary } = await import(
    "@/lib/actions/vendor-reports"
  )

  const perf = await getVendorPerformance("v-1")
  const contracts = await getVendorPerformanceContracts("v-1")
  const summary = await getVendorPerformanceSummary(
    "2020-01-01",
    "2030-12-31",
  )

  return {
    performance: perf.compliance,
    perContract: contracts[0].compliance,
    summary: summary[0].compliancePercent,
  }
}

describe("vendor compliance — one definition through every call path", () => {
  it("same inputs → same value (under target: 5,000 / 10,000 = 50%)", async () => {
    const { performance, perContract, summary } =
      await complianceThroughEveryPath()
    expect(performance).toBe(50)
    expect(perContract).toBe(50)
    expect(summary).toBe(50)
  })

  it("same inputs → same value at the cap (15,000 / 10,000 → 120, not 150 and not 100)", async () => {
    cogSpend12Mo = 15000
    const { performance, perContract, summary } =
      await complianceThroughEveryPath()
    // Pre-unification getVendorPerformance pinned this at 100 while the
    // per-contract rows said 120 — the exact drift this test guards.
    expect(performance).toBe(120)
    expect(perContract).toBe(120)
    expect(summary).toBe(120)
  })
})
