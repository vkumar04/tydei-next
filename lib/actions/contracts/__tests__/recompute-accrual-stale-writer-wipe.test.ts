/**
 * bugs.rtfd 2026-06-12 R1: a term-type edit must not leave the PRIOR
 * writer's rows behind.
 *
 * Prod proof: a volume contract's annual subtotal showed
 * `7,755 units · Tier 1 · $5.00/unit · $65,526` — but 7,755 × $5 =
 * $38,775. The term carried BOTH a correct
 * `[auto-volume-accrual] … $38775` row AND a stale
 * `[auto-threshold-accrual] … currentMarketShare=57.5% · tier 2 ·
 * $26,751` row from when the term WAS a market_share term
 * (38,775 + 26,751 = 65,526). The upfront wipe in
 * recomputeAccrualForContract deleted only the spend writer's
 * `[auto-accrual]` prefix; each specialty writer deletes only its own
 * prefix and only runs for terms currently of its type — so the
 * term-type change orphaned the threshold rows forever.
 *
 * Strategy (mirrors recompute-accrual-idempotent-tie-in.test.ts): stub
 * prisma.rebate as an in-memory store, pre-seed a stale
 * `[auto-threshold-accrual]` row on a contract whose only term is now
 * volume_rebate, run recompute, and assert the stale row is gone while
 * manual rows and user-collected auto rows survive.
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

// The contract's ONLY term is volume_rebate today — but it used to be
// a market_share term, and the threshold writer's rows are still in
// the store (seeded in beforeEach below).
const contractRow = {
  id: "contract-vol-1",
  facilityId: "fac-1",
  name: "Test Volume",
  contractType: "standard",
  vendorId: "vendor-1",
  additionalVendorIds: [],
  effectiveDate: new Date("2024-01-01T00:00:00Z"),
  expirationDate: new Date("2030-12-31T00:00:00Z"),
  currentMarketShare: null,
  complianceRate: null,
  capitalLineItems: [],
  productCategory: null,
  terms: [
    {
      id: "term-vol-1",
      termName: "Volume Rebate",
      termType: "volume_rebate",
      rebateMethod: "cumulative",
      evaluationPeriod: "annual",
      effectiveStart: new Date("2024-01-01T00:00:00Z"),
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
          rebateValue: 5,
          rebateType: "per_unit",
        },
      ],
    },
  ],
}

type WhereClause = Record<string, unknown>
type NotesFilter = { startsWith?: string }

// Faithful subset of Prisma where-matching for the filters the action
// uses: contractId, notes.startsWith, OR of notes.startsWith,
// collectionDate (null / { not: null }), payPeriodEnd.gt.
const rowMatchesWhere = (r: RebateRow, where: WhereClause): boolean => {
  if (where.contractId && r.contractId !== where.contractId) return false
  const notes = where.notes as NotesFilter | undefined
  if (notes?.startsWith && !r.notes.startsWith(notes.startsWith)) return false
  const or = where.OR as Array<{ notes?: NotesFilter }> | undefined
  if (
    or &&
    !or.some((b) => b.notes?.startsWith && r.notes.startsWith(b.notes.startsWith))
  )
    return false
  if ("collectionDate" in where) {
    if (where.collectionDate === null) {
      if (r.collectionDate !== null) return false
    } else if (
      typeof where.collectionDate === "object" &&
      where.collectionDate !== null
    ) {
      const f = where.collectionDate as { not?: null }
      if ("not" in f && f.not === null && r.collectionDate === null) return false
    }
  }
  if (where.payPeriodEnd && typeof where.payPeriodEnd === "object") {
    const f = where.payPeriodEnd as { gt?: Date }
    if (f.gt && r.payPeriodEnd <= f.gt) return false
  }
  return true
}

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUnique: vi.fn(async () => contractRow),
      findMany: vi.fn(async () => []),
    },
    rebate: {
      deleteMany: vi.fn(async ({ where }: { where: WhereClause }) => {
        const before = rebateStore.length
        rebateStore = rebateStore.filter((r) => !rowMatchesWhere(r, where))
        return { count: before - rebateStore.length }
      }),
      findMany: vi.fn(async ({ where }: { where: WhereClause }) =>
        rebateStore.filter((r) => rowMatchesWhere(r, where)),
      ),
      createMany: vi.fn(
        async ({ data }: { data: Omit<RebateRow, "id">[] }) => {
          for (const row of data) {
            rebateStore.push({ id: String(nextId++), ...row })
          }
          return { count: data.length }
        },
      ),
      aggregate: vi.fn(async ({ where }: { where: WhereClause }) => {
        const matched = rebateStore.filter((r) => rowMatchesWhere(r, where))
        return {
          _sum: {
            rebateEarned: matched.reduce((s, r) => s + r.rebateEarned, 0),
          },
        }
      }),
    },
    cOGRecord: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    case: {
      findMany: vi.fn(async () => []),
    },
    purchaseOrder: {
      findMany: vi.fn(async () => []),
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

const baseRow = {
  contractId: "contract-vol-1",
  facilityId: "fac-1",
  rebateCollected: 0,
  engineVersion: "test",
  engineWarnings: null,
}

describe("recomputeAccrualForContract — stale prior-writer rows (R1)", () => {
  beforeEach(() => {
    rebateStore = []
    nextId = 1
    // Stale row from when the term was market_share — its writer no
    // longer runs (term is volume_rebate now), so only the upfront
    // wipe can delete it.
    rebateStore.push({
      id: String(nextId++),
      ...baseRow,
      rebateEarned: 26_751,
      payPeriodStart: new Date("2025-01-01T00:00:00Z"),
      payPeriodEnd: new Date("2025-12-31T00:00:00Z"),
      collectionDate: null,
      notes:
        "[auto-threshold-accrual] term:term-vol-1 currentMarketShare=57.5% · tier 2 · $26751.00",
    })
    // A current-writer row (would normally be rewritten by the volume
    // dispatcher; with no COG data the dispatcher writes nothing back).
    rebateStore.push({
      id: String(nextId++),
      ...baseRow,
      rebateEarned: 38_775,
      payPeriodStart: new Date("2025-01-01T00:00:00Z"),
      payPeriodEnd: new Date("2025-12-31T00:00:00Z"),
      collectionDate: null,
      notes:
        "[auto-volume-accrual] term:term-vol-1 7755 units · tier 1 @ $5/unit",
    })
    // Manually-entered rebate — must NEVER be touched by any wipe.
    rebateStore.push({
      id: String(nextId++),
      ...baseRow,
      rebateEarned: 1_000,
      payPeriodStart: new Date("2024-04-01T00:00:00Z"),
      payPeriodEnd: new Date("2024-06-30T00:00:00Z"),
      collectionDate: null,
      notes: "Q2 rebate check from vendor",
    })
    // User-collected auto row — the preserveUserCollections gate must
    // keep it even though its prefix is in the wipe family.
    rebateStore.push({
      id: String(nextId++),
      ...baseRow,
      rebateEarned: 500,
      rebateCollected: 500,
      payPeriodStart: new Date("2024-01-01T00:00:00Z"),
      payPeriodEnd: new Date("2024-12-31T00:00:00Z"),
      collectionDate: new Date("2025-01-15T00:00:00Z"),
      notes: "[auto-threshold-accrual] term:term-vol-1 collected row",
    })
  })

  it("wipes stale prior-writer rows on recompute (term-type edit must not double-count)", async () => {
    const { recomputeAccrualForContract } = await import(
      "@/lib/actions/contracts/recompute-accrual"
    )

    await recomputeAccrualForContract("contract-vol-1")

    // The stale, uncollected [auto-threshold-accrual] row is GONE —
    // pre-fix it survived forever and double-counted every aggregate.
    const staleThreshold = rebateStore.filter(
      (r) =>
        r.notes.startsWith("[auto-threshold-accrual]") &&
        r.collectionDate === null,
    )
    expect(staleThreshold).toHaveLength(0)

    // Manual rebate row survives.
    expect(
      rebateStore.some((r) => r.notes === "Q2 rebate check from vendor"),
    ).toBe(true)

    // User-collected auto row survives (preserveUserCollections gate).
    expect(rebateStore.some((r) => r.collectionDate !== null)).toBe(true)

    // Every remaining auto-prefixed, uncollected row was written by a
    // writer that still owns a term on this contract (volume here).
    const autoUncollected = rebateStore.filter(
      (r) => r.notes.startsWith("[auto-") && r.collectionDate === null,
    )
    for (const r of autoUncollected) {
      expect(r.notes.startsWith("[auto-volume-accrual]")).toBe(true)
    }
  })

  it("the wipe filter covers every writer prefix in the family", async () => {
    const { AUTO_ACCRUAL_PREFIXES } = await import(
      "@/lib/contracts/recompute/auto-accrual-prefixes"
    )
    // Each prefix the writers actually stamp must be present, verbatim.
    expect(AUTO_ACCRUAL_PREFIXES).toEqual(
      expect.arrayContaining([
        "[auto-accrual]",
        "[auto-threshold-accrual]",
        "[auto-volume-accrual]",
        "[auto-carve-out-accrual]",
        "[auto-po-accrual]",
        "[auto-invoice-accrual]",
      ]),
    )

    const { prisma } = await import("@/lib/db")
    const { recomputeAccrualForContract } = await import(
      "@/lib/actions/contracts/recompute-accrual"
    )
    await recomputeAccrualForContract("contract-vol-1")

    // The MAIN upfront wipe (contractId + no payPeriodEnd bound) must
    // carry an OR clause spanning the whole family — assert against the
    // captured where-clauses so a regression to single-prefix fails here.
    const deleteCalls = (
      prisma.rebate.deleteMany as unknown as {
        mock: { calls: Array<[{ where: WhereClause }]> }
      }
    ).mock.calls
    const mainWipes = deleteCalls.filter(
      ([arg]) =>
        arg.where.contractId === "contract-vol-1" &&
        !("payPeriodEnd" in arg.where) &&
        Array.isArray(arg.where.OR),
    )
    expect(mainWipes.length).toBeGreaterThanOrEqual(1)
    const orPrefixes = (
      mainWipes[0][0].where.OR as Array<{ notes: { startsWith: string } }>
    ).map((b) => b.notes.startsWith)
    expect(orPrefixes).toEqual(
      expect.arrayContaining([...AUTO_ACCRUAL_PREFIXES]),
    )

    // The future-dated purge must be widened the same way.
    const futurePurges = deleteCalls.filter(
      ([arg]) =>
        arg.where.contractId === "contract-vol-1" &&
        "payPeriodEnd" in arg.where &&
        Array.isArray(arg.where.OR),
    )
    expect(futurePurges.length).toBeGreaterThanOrEqual(1)
  })
})
