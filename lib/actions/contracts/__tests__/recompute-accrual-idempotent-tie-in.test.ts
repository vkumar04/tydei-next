/**
 * Bug #16 (2026-05-24): Recompute Earned Rebates on tie-in contracts
 * must be idempotent. Pre-fix, every Recompute click on a tie-in
 * contract appended new rows because the auto-stamped collectionDate
 * (set by autoStampCollectionForTieIn) made every auto-accrual row
 * look "user-collected" to the delete filter (collectionDate: null),
 * so nothing was wiped before re-inserting.
 *
 * Strategy: stub prisma.rebate as an in-memory store so two calls to
 * recompute build state. Assert the row count from call #2 matches
 * call #1, and that no (payPeriodStart, payPeriodEnd) pair repeats.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type RebateRow = {
  id: string
  contractId: string
  facilityId: string
  rebateEarned: number
  rebateCollected: number
  payPeriodStart: Date
  payPeriodEnd: Date
  collectionDate: Date | null
  notes: string
  engineVersion: string
  engineWarnings: string | null
}

let rebateStore: RebateRow[] = []
let nextId = 1
const contractRow = {
  id: "contract-tie-in-1",
  facilityId: "fac-1",
  name: "Test Tie-In",
  contractType: "tie_in",
  vendorId: "vendor-1",
  effectiveDate: new Date("2023-01-01T00:00:00Z"),
  expirationDate: new Date("2030-12-31T00:00:00Z"),
  currentMarketShare: null,
  complianceRate: null,
  capitalLineItems: [{ paymentCadence: "monthly" }],
  productCategory: null,
  terms: [
    {
      id: "term-1",
      termName: "Spend Rebate",
      termType: "spend_rebate",
      rebateMethod: "cumulative",
      evaluationPeriod: "annual",
      effectiveStart: new Date("2023-01-01T00:00:00Z"),
      effectiveEnd: null,
      appliesTo: "all_products",
      categories: [],
      spendBaseline: null,
      baselineType: null,
      cptCodes: [],
      volumeType: null,
      tiers: [
        {
          tierNumber: 1,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          rebateValue: 0.03,
          rebateType: "percent_of_spend",
        },
      ],
    },
  ],
}

const cogRecords = [
  // ~$500k in 2023, $500k in 2024 — two completed annual windows.
  { transactionDate: new Date("2023-06-15T00:00:00Z"), extendedPrice: 500_000, category: null },
  { transactionDate: new Date("2024-06-15T00:00:00Z"), extendedPrice: 500_000, category: null },
]

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUnique: vi.fn(async () => contractRow),
      findMany: vi.fn(async () => []),
    },
    rebate: {
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const before = rebateStore.length
        rebateStore = rebateStore.filter((r) => {
          if (where.contractId && r.contractId !== where.contractId) return true
          const notes = where.notes as { startsWith?: string } | undefined
          if (notes?.startsWith && !r.notes.startsWith(notes.startsWith)) return true
          // bugs.rtfd 2026-06-12 R1: the upfront wipes now filter on an
          // OR of every auto-accrual prefix — mirror Prisma's semantics.
          const or = where.OR as
            | Array<{ notes?: { startsWith?: string } }>
            | undefined
          if (
            or &&
            !or.some(
              (b) =>
                b.notes?.startsWith && r.notes.startsWith(b.notes.startsWith),
            )
          )
            return true
          if ("collectionDate" in where && where.collectionDate === null) {
            if (r.collectionDate !== null) return true
          }
          if (where.payPeriodEnd && typeof where.payPeriodEnd === "object") {
            const filter = where.payPeriodEnd as { gt?: Date }
            if (filter.gt && r.payPeriodEnd <= filter.gt) return true
          }
          return false
        })
        return { count: before - rebateStore.length }
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return rebateStore.filter((r) => {
          if (where.contractId && r.contractId !== where.contractId) return false
          const notes = where.notes as { startsWith?: string } | undefined
          if (notes?.startsWith && !r.notes.startsWith(notes.startsWith)) return false
          if (where.collectionDate && typeof where.collectionDate === "object") {
            const filter = where.collectionDate as { not?: null }
            if ("not" in filter && filter.not === null && r.collectionDate === null) return false
          }
          return true
        })
      }),
      createMany: vi.fn(async ({ data }: { data: Omit<RebateRow, "id">[] }) => {
        for (const row of data) {
          rebateStore.push({ id: String(nextId++), ...row })
        }
        return { count: data.length }
      }),
      aggregate: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const matched = rebateStore.filter((r) => {
          if (where.contractId && r.contractId !== where.contractId) return false
          const notes = where.notes as { startsWith?: string } | undefined
          if (notes?.startsWith && !r.notes.startsWith(notes.startsWith)) return false
          return true
        })
        return { _sum: { rebateEarned: matched.reduce((s, r) => s + r.rebateEarned, 0) } }
      }),
    },
    cOGRecord: {
      findMany: vi.fn(async () => cogRecords),
      groupBy: vi.fn(async () => []),
    },
    contractPricing: {
      count: vi.fn(async () => 0),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1", name: "Test" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id, facilityId: "fac-1" }),
}))

describe("recomputeAccrualForContract — tie-in idempotency", () => {
  beforeEach(() => {
    rebateStore = []
    nextId = 1
  })

  it("emits the same row count on two consecutive calls (no duplicates)", async () => {
    const { recomputeAccrualForContract } = await import(
      "@/lib/actions/contracts/recompute-accrual"
    )

    const first = await recomputeAccrualForContract("contract-tie-in-1")
    const firstStoreSize = rebateStore.length

    const second = await recomputeAccrualForContract("contract-tie-in-1")
    const secondStoreSize = rebateStore.length

    // Idempotent: store size after run #2 must equal run #1.
    expect(secondStoreSize).toBe(firstStoreSize)

    // And no (start, end) pair repeats.
    const keys = rebateStore.map(
      (r) => `${r.payPeriodStart.toISOString()}|${r.payPeriodEnd.toISOString()}`,
    )
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(keys.length)

    // Sanity: both runs reported the same sumEarned.
    expect(second.sumEarned).toBe(first.sumEarned)
  })
})
