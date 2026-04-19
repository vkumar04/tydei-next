/**
 * Tests for the Charles W1.Q ledger filter.
 *
 * `getContractRebates` backs the contract detail Transactions tab. Per
 * CLAUDE.md doctrine, earned rebates are only counted when
 * `payPeriodEnd <= today` — but the ledger query historically returned
 * *all* Rebate rows for a contract, so future-dated auto-accrual rows
 * (seeded or written by a pre-R5.26 script) leaked into the visible
 * list even though the aggregations excluded them.
 *
 * This test pins system time and asserts:
 *   1. Future-dated rows are excluded from the returned rows.
 *   2. A row with `payPeriodEnd === today` is still included (the
 *      boundary matches the `<= today` rule).
 *   3. The `where` clause passed to Prisma carries the explicit
 *      `payPeriodEnd: { lte: today }` filter so the filter happens at
 *      the DB boundary, not after-the-fact in JS.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type RebateRow = {
  id: string
  rebateEarned: number
  rebateCollected: number
  payPeriodStart: Date
  payPeriodEnd: Date
  collectionDate: Date | null
  notes: string | null
  createdAt: Date
}

type FindManyArgs = {
  where: {
    contractId: string
    payPeriodEnd?: { lte: Date }
  }
  orderBy: { payPeriodEnd: "desc" }
  select: Record<string, boolean>
}

const { rebateFindManyMock, contractFindUniqueMock } = vi.hoisted(() => ({
  rebateFindManyMock: vi.fn(),
  contractFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: contractFindUniqueMock,
    },
    rebate: {
      findMany: rebateFindManyMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T>(v: T) => v,
}))

import { getContractRebates } from "@/lib/actions/contract-periods"

describe("getContractRebates — future-dated row filter (Charles W1.Q)", () => {
  // Pin today = 2026-04-19 (matches the Charles ticket's "today").
  const FIXED_NOW = new Date("2026-04-19T12:00:00Z")

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
    contractFindUniqueMock.mockResolvedValue({ id: "c-1" })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("passes payPeriodEnd <= today to Prisma so future rows are excluded at the DB boundary", async () => {
    rebateFindManyMock.mockResolvedValue([])

    await getContractRebates("c-1")

    expect(rebateFindManyMock).toHaveBeenCalledTimes(1)
    const args = rebateFindManyMock.mock.calls[0][0] as FindManyArgs
    expect(args.where.contractId).toBe("c-1")
    expect(args.where.payPeriodEnd).toBeDefined()
    // The filter bound should equal "now" at the time of the call.
    expect(args.where.payPeriodEnd?.lte.getTime()).toBe(FIXED_NOW.getTime())
  })

  it("returns only the 3 past rows when 2 of the 5 DB rows are future-dated", async () => {
    // Simulate Prisma's filter by keying off the `payPeriodEnd.lte`
    // argument the action provides. The test harness doesn't run a real
    // DB; it verifies getContractRebates wires the filter through and
    // returns the filtered set Prisma would give back.
    const allRows: RebateRow[] = [
      // Past — included
      {
        id: "r1",
        rebateEarned: 100,
        rebateCollected: 0,
        payPeriodStart: new Date("2026-01-01"),
        payPeriodEnd: new Date("2026-01-31"),
        collectionDate: null,
        notes: "[auto-accrual]",
        createdAt: new Date("2026-02-01"),
      },
      {
        id: "r2",
        rebateEarned: 200,
        rebateCollected: 0,
        payPeriodStart: new Date("2026-02-01"),
        payPeriodEnd: new Date("2026-02-28"),
        collectionDate: null,
        notes: "[auto-accrual]",
        createdAt: new Date("2026-03-01"),
      },
      {
        id: "r3",
        rebateEarned: 300,
        rebateCollected: 0,
        payPeriodStart: new Date("2026-03-01"),
        payPeriodEnd: new Date("2026-03-31"),
        collectionDate: null,
        notes: "[auto-accrual]",
        createdAt: new Date("2026-04-01"),
      },
      // Future — excluded
      {
        id: "r4",
        rebateEarned: 9999,
        rebateCollected: 0,
        payPeriodStart: new Date("2028-11-01"),
        payPeriodEnd: new Date("2028-11-30"),
        collectionDate: null,
        notes: "[auto-accrual]",
        createdAt: new Date("2026-04-18"),
      },
      {
        id: "r5",
        rebateEarned: 4242,
        rebateCollected: 0,
        payPeriodStart: new Date("2099-12-01"),
        payPeriodEnd: new Date("2099-12-31"),
        collectionDate: null,
        notes: "[auto-accrual]",
        createdAt: new Date("2026-04-18"),
      },
    ]

    rebateFindManyMock.mockImplementation(async (args: FindManyArgs) => {
      const lte = args.where.payPeriodEnd?.lte
      if (!lte) return allRows
      return allRows.filter((r) => r.payPeriodEnd.getTime() <= lte.getTime())
    })

    const result = (await getContractRebates("c-1")) as unknown as RebateRow[]

    expect(result).toHaveLength(3)
    const ids = result.map((r) => r.id).sort()
    expect(ids).toEqual(["r1", "r2", "r3"])
    // Future ids are absent.
    expect(ids).not.toContain("r4")
    expect(ids).not.toContain("r5")
  })

  it("includes a row whose payPeriodEnd equals today (boundary <= today)", async () => {
    const todayRow: RebateRow = {
      id: "today-row",
      rebateEarned: 500,
      rebateCollected: 0,
      payPeriodStart: new Date("2026-04-01"),
      payPeriodEnd: FIXED_NOW, // exactly today
      collectionDate: null,
      notes: "[auto-accrual]",
      createdAt: FIXED_NOW,
    }

    rebateFindManyMock.mockImplementation(async (args: FindManyArgs) => {
      const lte = args.where.payPeriodEnd?.lte
      if (!lte) return [todayRow]
      return [todayRow].filter(
        (r) => r.payPeriodEnd.getTime() <= lte.getTime(),
      )
    })

    const result = (await getContractRebates("c-1")) as unknown as RebateRow[]
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("today-row")
  })
})
