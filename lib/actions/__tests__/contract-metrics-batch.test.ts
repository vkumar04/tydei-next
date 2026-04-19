/**
 * Tests for getContractMetricsBatch — the per-row metrics aggregator
 * for the contracts list page (contracts-list-closure subsystem 1).
 *
 * Exercises the 3-tier spend resolution chain + rebate computation
 * from tiers + fallbacks with mocked prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type GroupByCog = Array<{
  contractId: string | null
  vendorId?: string | null
  _sum: { extendedPrice: number }
}>

type GroupByPeriod = Array<{
  contractId: string
  _sum: { totalSpend?: number; rebateEarned?: number }
}>

type GroupByRebate = Array<{
  contractId: string
  _sum: { rebateEarned: number }
}>

let cogGroupByContract: GroupByCog = []
let cogGroupByVendor: GroupByCog = []
let periodGroupByContract: GroupByPeriod = []
let rebateGroupByContract: GroupByRebate = []
let periodRebateGroupByContract: GroupByPeriod = []
let contractRows: Array<{
  id: string
  vendorId: string
  totalValue: number
  terms: Array<{
    rebateMethod: "cumulative" | "marginal" | null
    tiers: Array<{
      tierNumber: number
      spendMin: number
      spendMax: number | null
      rebateValue: number
    }>
  }>
}> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(async () => contractRows),
    },
    cOGRecord: {
      groupBy: vi.fn(async ({ by }: { by: string[] }) => {
        if (by.includes("contractId")) return cogGroupByContract
        if (by.includes("vendorId")) return cogGroupByVendor
        return []
      }),
    },
    contractPeriod: {
      groupBy: vi.fn(async ({ _sum }: { _sum: Record<string, boolean> }) => {
        // Two distinct calls on contractPeriod.groupBy — one for totalSpend
        // (spend fallback), one for rebateEarned (rebate fallback). Route
        // by the _sum selector.
        if (_sum.rebateEarned) return periodRebateGroupByContract
        return periodGroupByContract
      }),
    },
    rebate: {
      groupBy: vi.fn(async () => rebateGroupByContract),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

import { getContractMetricsBatch } from "@/lib/actions/contracts"

beforeEach(() => {
  vi.clearAllMocks()
  cogGroupByContract = []
  cogGroupByVendor = []
  periodGroupByContract = []
  rebateGroupByContract = []
  periodRebateGroupByContract = []
  contractRows = []
})

describe("getContractMetricsBatch — resolution chain", () => {
  it("returns empty object for empty input", async () => {
    const result = await getContractMetricsBatch([])
    expect(result).toEqual({})
  })

  it("pulls spend from COGRecord.contractId (pass 1)", async () => {
    contractRows = [
      {
        id: "c-1",
        vendorId: "v-1",
        totalValue: 100000,
        terms: [
          {
            rebateMethod: "cumulative",
            tiers: [
              { tierNumber: 1, spendMin: 0, spendMax: 50000, rebateValue: 2 },
              { tierNumber: 2, spendMin: 50000, spendMax: null, rebateValue: 4 },
            ],
          },
        ],
      },
    ]
    cogGroupByContract = [
      { contractId: "c-1", _sum: { extendedPrice: 75000 } },
    ]
    cogGroupByVendor = [
      { contractId: null, vendorId: "v-1", _sum: { extendedPrice: 80000 } },
    ]
    // Rebate is recorded, not computed: seed a matching Rebate row.
    rebateGroupByContract = [
      { contractId: "c-1", _sum: { rebateEarned: 3000 } },
    ]

    const result = await getContractMetricsBatch(["c-1"])
    expect(result["c-1"].spend).toBe(75000)
    expect(result["c-1"].rebate).toBe(3000)
    expect(result["c-1"].totalValue).toBe(100000)
  })

  it("falls back to ContractPeriod.totalSpend when COG-by-contract is zero (pass 2)", async () => {
    contractRows = [
      {
        id: "c-1",
        vendorId: "v-1",
        totalValue: 100000,
        terms: [],
      },
    ]
    cogGroupByContract = [] // no enrichment yet
    periodGroupByContract = [
      { contractId: "c-1", _sum: { totalSpend: 42000 } },
    ]
    cogGroupByVendor = [
      { contractId: null, vendorId: "v-1", _sum: { extendedPrice: 100000 } },
    ]

    const result = await getContractMetricsBatch(["c-1"])
    // Pass 2 wins over pass 3 (vendor-wide)
    expect(result["c-1"].spend).toBe(42000)
  })

  it("falls back to vendor-wide COG when passes 1+2 yield zero (pass 3)", async () => {
    contractRows = [
      {
        id: "c-1",
        vendorId: "v-1",
        totalValue: 100000,
        terms: [],
      },
    ]
    cogGroupByContract = []
    periodGroupByContract = []
    cogGroupByVendor = [
      { contractId: null, vendorId: "v-1", _sum: { extendedPrice: 25000 } },
    ]

    const result = await getContractMetricsBatch(["c-1"])
    expect(result["c-1"].spend).toBe(25000)
  })

  it("returns zero spend when every fallback is empty", async () => {
    contractRows = [
      { id: "c-1", vendorId: "v-1", totalValue: 100000, terms: [] },
    ]

    const result = await getContractMetricsBatch(["c-1"])
    expect(result["c-1"].spend).toBe(0)
    expect(result["c-1"].rebate).toBe(0)
    expect(result["c-1"].totalValue).toBe(100000)
  })
})

describe("getContractMetricsBatch — rebate (recorded, not computed)", () => {
  // Rebate is *never* auto-computed from tier engines on the contracts
  // list. It comes from explicit Rebate rows (preferred) or the
  // ContractPeriod rollup fallback. See commit 38a2c05 and the
  // "rebates are never auto-computed for display" rule in
  // docs/superpowers/specs/2026-04-18-contracts-rewrite.md.
  it("sums Rebate.rebateEarned for closed periods", async () => {
    contractRows = [
      {
        id: "c-1",
        vendorId: "v-1",
        totalValue: 200000,
        terms: [],
      },
    ]
    cogGroupByContract = [
      { contractId: "c-1", _sum: { extendedPrice: 150000 } },
    ]
    rebateGroupByContract = [
      { contractId: "c-1", _sum: { rebateEarned: 7500 } },
    ]

    const result = await getContractMetricsBatch(["c-1"])
    expect(result["c-1"].rebate).toBe(7500)
  })

  it("falls back to ContractPeriod.rebateEarned when no Rebate rows exist", async () => {
    contractRows = [
      { id: "c-1", vendorId: "v-1", totalValue: 100000, terms: [] },
    ]
    cogGroupByContract = [
      { contractId: "c-1", _sum: { extendedPrice: 50000 } },
    ]
    periodRebateGroupByContract = [
      { contractId: "c-1", _sum: { rebateEarned: 2500 } },
    ]

    const result = await getContractMetricsBatch(["c-1"])
    expect(result["c-1"].rebate).toBe(2500)
  })

  it("returns zero rebate when no Rebate rows and no ContractPeriod rebate exist", async () => {
    contractRows = [
      { id: "c-1", vendorId: "v-1", totalValue: 100000, terms: [] },
    ]
    cogGroupByContract = [
      { contractId: "c-1", _sum: { extendedPrice: 50000 } },
    ]

    const result = await getContractMetricsBatch(["c-1"])
    expect(result["c-1"].rebate).toBe(0)
    expect(result["c-1"].spend).toBe(50000)
  })
})

describe("getContractMetricsBatch — batch behavior", () => {
  it("handles multiple contracts in a single call", async () => {
    contractRows = [
      {
        id: "c-1",
        vendorId: "v-1",
        totalValue: 100000,
        terms: [
          {
            rebateMethod: "cumulative",
            tiers: [
              { tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 3 },
            ],
          },
        ],
      },
      {
        id: "c-2",
        vendorId: "v-2",
        totalValue: 50000,
        terms: [],
      },
    ]
    cogGroupByContract = [
      { contractId: "c-1", _sum: { extendedPrice: 60000 } },
      { contractId: "c-2", _sum: { extendedPrice: 20000 } },
    ]
    rebateGroupByContract = [
      { contractId: "c-1", _sum: { rebateEarned: 1800 } },
    ]

    const result = await getContractMetricsBatch(["c-1", "c-2"])
    expect(Object.keys(result)).toHaveLength(2)
    expect(result["c-1"].spend).toBe(60000)
    expect(result["c-1"].rebate).toBe(1800)
    expect(result["c-2"].spend).toBe(20000)
    expect(result["c-2"].rebate).toBe(0) // no recorded Rebate rows
  })

  it("omits contracts the facility doesn't own", async () => {
    // prisma.contract.findMany only returns contracts owned by this facility;
    // a contractId passed in that doesn't belong to the facility yields no row.
    contractRows = [] // simulated: nothing matches ownership

    const result = await getContractMetricsBatch(["c-1", "c-2", "c-other"])
    expect(Object.keys(result)).toEqual([])
  })
})
