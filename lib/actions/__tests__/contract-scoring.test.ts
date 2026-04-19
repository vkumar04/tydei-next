/**
 * Tests for recomputeContractScore + recomputeAllContractScores —
 * the Contract.score persistence server actions. Mocks prisma following
 * the pattern in contract-metrics-batch.test.ts, and verifies both the
 * wiring into the pure engine (lib/contracts/scoring.ts) and the write
 * path for score / scoreBand / scoreUpdatedAt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type ContractRow = {
  id: string
  vendorId: string
  facilityId: string | null
  totalValue: number
  currentMarketShare: number | null
  marketShareCommitment: number | null
  expirationDate: Date
  status: "active" | "expiring" | "expired" | "draft" | "pending"
  rebates: Array<{ rebateEarned: number }>
}

type VarianceRow = { severity: "minor" | "moderate" | "major" }

let contracts: ContractRow[] = []
let onContractSum = 0
let vendorSum = 0
let variances: VarianceRow[] = []
let lastUpdate:
  | { where: { id: string }; data: Record<string, unknown> }
  | null = null
let updateCalls = 0

const contractFindUniqueOrThrow = vi.fn(
  async ({
    where,
  }: {
    where: {
      id: string
      OR?: Array<{ facilityId?: string } | { contractFacilities?: unknown }>
    }
  }) => {
    const facilityFromOr =
      where.OR?.find((c): c is { facilityId: string } =>
        typeof (c as { facilityId?: string }).facilityId === "string",
      )?.facilityId ?? null
    const row = contracts.find((c) => c.id === where.id)
    if (!row) throw new Error("Contract not found")
    // Simulate ownership filter: drop if facility doesn't match.
    if (
      facilityFromOr != null &&
      row.facilityId != null &&
      row.facilityId !== facilityFromOr
    ) {
      throw new Error("Contract not found for facility")
    }
    return row
  },
)

const contractFindMany = vi.fn(async () => contracts)
const contractUpdate = vi.fn(
  async ({
    where,
    data,
  }: {
    where: { id: string }
    data: Record<string, unknown>
  }) => {
    lastUpdate = { where, data }
    updateCalls += 1
    const row = contracts.find((c) => c.id === where.id)
    if (!row) throw new Error("no row")
    return { ...row, ...data }
  },
)

const cogAggregate = vi.fn(
  async ({
    where,
  }: {
    where: { contractId?: string; isOnContract?: boolean; vendorId?: string }
  }) => {
    // On-contract slice: contractId set + isOnContract=true
    if (where.contractId && where.isOnContract === true) {
      return { _sum: { extendedPrice: onContractSum } }
    }
    // Vendor-wide slice
    if (where.vendorId) {
      return { _sum: { extendedPrice: vendorSum } }
    }
    return { _sum: { extendedPrice: 0 } }
  },
)

const variancefindMany = vi.fn(async () => variances)

const auditCreate = vi.fn(async (_args: unknown) => ({ id: "audit-1" }))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: (args: {
        where: {
          id: string
          OR?: Array<{ facilityId?: string } | { contractFacilities?: unknown }>
        }
      }) => contractFindUniqueOrThrow(args),
      findMany: () => contractFindMany(),
      update: (args: {
        where: { id: string }
        data: Record<string, unknown>
      }) => contractUpdate(args),
    },
    cOGRecord: {
      aggregate: (args: {
        where: {
          contractId?: string
          isOnContract?: boolean
          vendorId?: string
        }
      }) => cogAggregate(args),
    },
    invoicePriceVariance: {
      findMany: () => variancefindMany(),
    },
    auditLog: {
      create: (args: unknown) => auditCreate(args),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

import { recomputeContractScore, recomputeAllContractScores } from "@/lib/actions/contracts/scoring"

function makeContract(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    id: "c-1",
    vendorId: "v-1",
    facilityId: "fac-test",
    totalValue: 100000,
    currentMarketShare: 80,
    marketShareCommitment: 100,
    // Expires in ~200 days (>= 180 → timelinessScore=100)
    expirationDate: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
    status: "active",
    rebates: [{ rebateEarned: 5000 }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contracts = []
  onContractSum = 0
  vendorSum = 0
  variances = []
  lastUpdate = null
  updateCalls = 0
})

describe("recomputeContractScore — happy path", () => {
  it("computes + persists score for a healthy contract", async () => {
    contracts = [makeContract()]
    onContractSum = 80000
    vendorSum = 100000
    variances = [] // no variance rows → varianceScore=100

    const result = await recomputeContractScore("c-1")

    // commitmentMet = 80/100*100 = 80 → commitmentScore=80
    expect(result.components.commitmentScore).toBe(80)
    // complianceRate = 80000/100000*100 = 80 → complianceScore=80
    expect(result.components.complianceScore).toBe(80)
    // rebateEfficiency = 5000/100000*1000 = 50
    expect(result.components.rebateEfficiencyScore).toBe(50)
    // timeliness = 100 (>= 180 days)
    expect(result.components.timelinessScore).toBe(100)
    // variance = 100 (no rows)
    expect(result.components.varianceScore).toBe(100)
    // Weights (commit 0ea0165 added the 6th dim + reweighted):
    //   commitment .20, compliance .20, rebateEff .20, timeliness .15,
    //   variance .15, priceCompetitiveness .10
    // 80*.20 + 80*.20 + 50*.20 + 100*.15 + 100*.15 + 100*.10 = 16+16+10+15+15+10 = 82
    expect(result.overallScore).toBeCloseTo(82, 5)
    expect(result.band).toBe("B")

    // Persisted with rounded score, band, and a timestamp.
    expect(updateCalls).toBe(1)
    expect(lastUpdate?.where).toEqual({ id: "c-1" })
    expect(lastUpdate?.data.score).toBe(82)
    expect(lastUpdate?.data.scoreBand).toBe("B")
    expect(lastUpdate?.data.scoreUpdatedAt).toBeInstanceOf(Date)
  })
})

describe("recomputeContractScore — component edge cases", () => {
  it("zero totalContractValue → rebateEfficiencyScore=0 but other components still computed", async () => {
    contracts = [makeContract({ totalValue: 0 })]
    onContractSum = 50000
    vendorSum = 100000

    const result = await recomputeContractScore("c-1")
    expect(result.components.rebateEfficiencyScore).toBe(0)
    // commitment falls back to market-share path first (still populated),
    // so commitmentScore=80 regardless of zero totalValue.
    expect(result.components.commitmentScore).toBe(80)
    // complianceScore comes from the COG ratio, independent of totalValue.
    expect(result.components.complianceScore).toBe(50)
    expect(updateCalls).toBe(1)
  })

  it("expired contract → timelinessScore=0", async () => {
    contracts = [
      makeContract({
        expirationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      }),
    ]
    onContractSum = 50000
    vendorSum = 100000

    const result = await recomputeContractScore("c-1")
    expect(result.components.timelinessScore).toBe(0)
    expect(updateCalls).toBe(1)
  })

  it("no variance rows → varianceScore=100", async () => {
    contracts = [makeContract()]
    onContractSum = 10000
    vendorSum = 20000
    variances = []

    const result = await recomputeContractScore("c-1")
    expect(result.components.varianceScore).toBe(100)
  })

  it("no COG records → complianceRate=0", async () => {
    contracts = [makeContract()]
    onContractSum = 0
    vendorSum = 0

    const result = await recomputeContractScore("c-1")
    expect(result.components.complianceScore).toBe(0)
  })

  it("half of variance rows major → varianceScore=50", async () => {
    contracts = [makeContract()]
    variances = [
      { severity: "major" },
      { severity: "minor" },
      { severity: "major" },
      { severity: "moderate" },
    ]

    const result = await recomputeContractScore("c-1")
    // 2 major / 4 total → 50
    expect(result.components.varianceScore).toBe(50)
  })

  it("falls back to rebates/totalValue commitment when market-share fields null", async () => {
    contracts = [
      makeContract({
        currentMarketShare: null,
        marketShareCommitment: null,
        totalValue: 100000,
        rebates: [{ rebateEarned: 40000 }],
      }),
    ]

    const result = await recomputeContractScore("c-1")
    // 40000/100000*100 = 40
    expect(result.components.commitmentScore).toBe(40)
  })
})

describe("recomputeContractScore — ownership", () => {
  it("throws when contract is not in caller's facility", async () => {
    contracts = [makeContract({ facilityId: "fac-other" })]

    await expect(recomputeContractScore("c-1")).rejects.toThrow(/not found/i)
    expect(updateCalls).toBe(0)
  })
})

describe("recomputeAllContractScores", () => {
  it("iterates active+expiring contracts and returns counts", async () => {
    contracts = [
      makeContract({ id: "c-1", status: "active" }),
      makeContract({ id: "c-2", status: "expiring" }),
    ]
    onContractSum = 10000
    vendorSum = 20000

    const result = await recomputeAllContractScores()
    expect(result.updated).toBe(2)
    expect(result.skipped).toBe(0)
    expect(updateCalls).toBe(2)
  })
})
