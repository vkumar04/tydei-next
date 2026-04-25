/**
 * Tests for updateContractTransaction + deleteContractTransaction
 * (Charles W1.X-A).
 *
 * These actions give users a way to correct a logged collection —
 * edit the amount, fix a bad collection date, or delete a user-logged
 * row entirely. The server actions guard via requireFacility +
 * contractOwnershipWhere, must never touch `rebateEarned` (engine
 * domain), and must refuse to delete engine-generated rows (notes
 * contains `[auto-accrual]`).
 *
 * Mocks prisma following the pattern used in contract-scoring.test.ts
 * — no live DB; the prisma surface for Rebate + Contract is stubbed
 * in-process so we can assert the shape of update/delete calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── In-memory Rebate + Contract store for the mock ───────────────
type RebateRow = {
  id: string
  contractId: string
  facilityId: string
  rebateEarned: number
  rebateCollected: number
  payPeriodStart: Date
  payPeriodEnd: Date
  collectionDate: Date | null
  notes: string | null
}

type ContractRow = {
  id: string
  facilityId: string
}

let rebates: RebateRow[] = []
let contracts: ContractRow[] = []
let callerFacility = "fac-test"

// Contract ownership mock matches contractOwnershipWhere shape:
//   { id, OR: [{ facilityId }, { contractFacilities: { some: { facilityId } } }] }
const contractFindUniqueOrThrow = vi.fn(
  async ({
    where,
  }: {
    where: {
      id: string
      OR?: Array<
        { facilityId?: string } | { contractFacilities?: unknown }
      >
    }
  }) => {
    const row = contracts.find((c) => c.id === where.id)
    if (!row) throw new Error("Contract not found")
    const facFromOr =
      where.OR?.find((c): c is { facilityId: string } =>
        typeof (c as { facilityId?: string }).facilityId === "string",
      )?.facilityId ?? null
    if (facFromOr != null && row.facilityId !== facFromOr) {
      throw new Error("Contract not found for facility")
    }
    return { id: row.id }
  },
)

const rebateFindUniqueOrThrow = vi.fn(
  async ({ where }: { where: { id: string } }) => {
    const row = rebates.find((r) => r.id === where.id)
    if (!row) throw new Error("Rebate not found")
    return {
      id: row.id,
      contractId: row.contractId,
      notes: row.notes,
    }
  },
)

const rebateUpdate = vi.fn(
  async ({
    where,
    data,
  }: {
    where: { id: string }
    data: Record<string, unknown>
  }) => {
    const idx = rebates.findIndex((r) => r.id === where.id)
    if (idx < 0) throw new Error("Rebate not found")
    const cur = rebates[idx]
    const next: RebateRow = { ...cur }
    if ("rebateCollected" in data) {
      next.rebateCollected = Number(data.rebateCollected)
    }
    if ("collectionDate" in data) {
      const v = data.collectionDate
      next.collectionDate =
        v === null ? null : v instanceof Date ? v : new Date(String(v))
    }
    if ("notes" in data) {
      next.notes = data.notes == null ? null : String(data.notes)
    }
    rebates[idx] = next
    return next
  },
)

const rebateDelete = vi.fn(async ({ where }: { where: { id: string } }) => {
  const idx = rebates.findIndex((r) => r.id === where.id)
  if (idx < 0) throw new Error("Rebate not found")
  const [removed] = rebates.splice(idx, 1)
  return removed
})

const rebateFindUnique = vi.fn(
  async ({ where }: { where: { id: string } }) => {
    return rebates.find((r) => r.id === where.id) ?? null
  },
)

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: (args: {
        where: {
          id: string
          OR?: Array<
            { facilityId?: string } | { contractFacilities?: unknown }
          >
        }
      }) => contractFindUniqueOrThrow(args),
    },
    rebate: {
      findUniqueOrThrow: (args: { where: { id: string } }) =>
        rebateFindUniqueOrThrow(args),
      // Round-12 deferred-fix: scoped lookup uses findFirstOrThrow.
      findFirstOrThrow: (args: { where: { id: string; contractId?: string } }) =>
        rebateFindUniqueOrThrow(args),
      findUnique: (args: { where: { id: string } }) =>
        rebateFindUnique(args),
      update: (args: {
        where: { id: string }
        data: Record<string, unknown>
      }) => rebateUpdate(args),
      delete: (args: { where: { id: string } }) => rebateDelete(args),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: callerFacility },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

import {
  updateContractTransaction,
  deleteContractTransaction,
} from "@/lib/actions/contract-periods"

// ─── Inline fixture helper (plan: inline if not in tests/helpers) ─────
//
// Seeds one Contract + one Rebate row matching the requested shape and
// returns IDs for the test to reference. The `facility: "other"` option
// seeds the row under a different facilityId so the caller (whose
// requireFacility mock returns `fac-test`) fails the ownership check.
async function seedCollectedRebate(opts: {
  earned: number
  collected: number
  collectionDate?: string | null
  notes?: string | null
  facility?: "self" | "other"
}): Promise<{
  contractId: string
  rebateId: string
  originalEarned: number
}> {
  const facilityId = opts.facility === "other" ? "fac-other" : "fac-test"
  const contractId = `c-${contracts.length + 1}`
  const rebateId = `r-${rebates.length + 1}`
  contracts.push({ id: contractId, facilityId })
  rebates.push({
    id: rebateId,
    contractId,
    facilityId,
    rebateEarned: opts.earned,
    rebateCollected: opts.collected,
    payPeriodStart: new Date("2025-01-01"),
    payPeriodEnd: new Date("2025-01-31"),
    collectionDate:
      opts.collectionDate === undefined
        ? null
        : opts.collectionDate === null
          ? null
          : new Date(opts.collectionDate),
    notes: opts.notes ?? null,
  })
  return { contractId, rebateId, originalEarned: opts.earned }
}

beforeEach(() => {
  vi.clearAllMocks()
  rebates = []
  contracts = []
  callerFacility = "fac-test"
})

describe("updateContractTransaction", () => {
  it("updates amount and collection date without touching rebateEarned", async () => {
    const { contractId, rebateId, originalEarned } = await seedCollectedRebate({
      earned: 1000,
      collected: 500,
      collectionDate: "2025-01-15",
    })

    await updateContractTransaction({
      id: rebateId,
      contractId,
      rebateCollected: 750,
      collectionDate: "2025-02-01",
    })

    const row = rebates.find((r) => r.id === rebateId)
    expect(row).toBeDefined()
    expect(Number(row!.rebateCollected)).toBe(750)
    expect(row!.collectionDate?.toISOString().slice(0, 10)).toBe("2025-02-01")
    expect(Number(row!.rebateEarned)).toBe(originalEarned)
  })

  it("uncollect clears collectionDate and zeros collected but preserves earned", async () => {
    const { contractId, rebateId, originalEarned } = await seedCollectedRebate({
      earned: 1200,
      collected: 1200,
      collectionDate: "2025-01-15",
    })

    await updateContractTransaction({
      id: rebateId,
      contractId,
      rebateCollected: 0,
      collectionDate: null,
    })

    const row = rebates.find((r) => r.id === rebateId)
    expect(row).toBeDefined()
    expect(row!.collectionDate).toBeNull()
    expect(Number(row!.rebateCollected)).toBe(0)
    expect(Number(row!.rebateEarned)).toBe(originalEarned)
  })

  it("rejects updates from other facilities", async () => {
    const { rebateId, contractId } = await seedCollectedRebate({
      facility: "other",
      earned: 500,
      collected: 0,
    })
    await expect(
      updateContractTransaction({
        id: rebateId,
        contractId,
        rebateCollected: 100,
      }),
    ).rejects.toThrow()
  })
})

describe("deleteContractTransaction", () => {
  it("removes a user-logged Rebate row", async () => {
    const { contractId, rebateId } = await seedCollectedRebate({
      earned: 300,
      collected: 300,
      collectionDate: "2025-02-10",
      notes: "Manually logged by Charles",
    })
    await deleteContractTransaction({ id: rebateId, contractId })
    const row = rebates.find((r) => r.id === rebateId) ?? null
    expect(row).toBeNull()
  })

  it("refuses to delete engine-generated [auto-accrual] rows", async () => {
    const { contractId, rebateId } = await seedCollectedRebate({
      earned: 500,
      collected: 0,
      notes: "[auto-accrual] Q1 2025",
    })
    await expect(
      deleteContractTransaction({ id: rebateId, contractId }),
    ).rejects.toThrow(/auto-accrual/i)
    const stillThere = rebates.find((r) => r.id === rebateId)
    expect(stillThere).toBeDefined()
  })

  it("rejects deletes from other facilities", async () => {
    const { rebateId, contractId } = await seedCollectedRebate({
      facility: "other",
      earned: 500,
      collected: 0,
    })
    await expect(
      deleteContractTransaction({ id: rebateId, contractId }),
    ).rejects.toThrow()
  })
})

