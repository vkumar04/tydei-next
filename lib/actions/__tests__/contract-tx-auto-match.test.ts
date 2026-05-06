/**
 * Bug #2 regression: createContractTransaction's auto-match for a
 * collected rebate must reconcile against earned-uncollected rows.
 *
 * Pre-fix: when no period window contained the collection date, the
 * action created an `[out-of-band]` orphan row with rebateEarned=0,
 * leaving every prior earned period stuck Outstanding. The dialog's
 * default option ("Auto-match oldest uncollected earned period")
 * silently misled users.
 *
 * Post-fix: auto-match falls back from "windowed" → "oldest
 * uncollected" → orphan, mirroring the dropdown label.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

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

type ContractRow = { id: string; facilityId: string }

let rebates: RebateRow[] = []
let contracts: ContractRow[] = []

const contractFindUniqueOrThrow = vi.fn(
  async ({ where }: { where: { id: string } }) => {
    const row = contracts.find((c) => c.id === where.id)
    if (!row) throw new Error("Contract not found")
    return { id: row.id }
  },
)

const rebateFindFirst = vi.fn(
  async (args: {
    where: {
      id?: string
      contractId?: string
      collectionDate?: null
      rebateEarned?: { gt?: number }
      payPeriodStart?: { lte?: Date }
      payPeriodEnd?: { gte?: Date }
    }
    orderBy?: { payPeriodEnd?: "asc" | "desc" }
  }) => {
    const w = args.where
    const matches = rebates.filter((r) => {
      if (w.id && r.id !== w.id) return false
      if (w.contractId && r.contractId !== w.contractId) return false
      if (w.collectionDate === null && r.collectionDate !== null) return false
      if (w.rebateEarned?.gt != null && !(r.rebateEarned > w.rebateEarned.gt))
        return false
      if (
        w.payPeriodStart?.lte != null &&
        r.payPeriodStart > w.payPeriodStart.lte
      )
        return false
      if (w.payPeriodEnd?.gte != null && r.payPeriodEnd < w.payPeriodEnd.gte)
        return false
      return true
    })
    matches.sort(
      (a, b) =>
        a.payPeriodEnd.getTime() - b.payPeriodEnd.getTime(),
    )
    if (args.orderBy?.payPeriodEnd === "desc") matches.reverse()
    return matches[0] ?? null
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
    const next = { ...cur }
    if ("rebateCollected" in data)
      next.rebateCollected = Number(data.rebateCollected)
    if ("collectionDate" in data) {
      const v = data.collectionDate
      next.collectionDate =
        v === null ? null : v instanceof Date ? v : new Date(String(v))
    }
    if ("notes" in data) next.notes = data.notes == null ? null : String(data.notes)
    rebates[idx] = next
    return next
  },
)

const rebateCreate = vi.fn(
  async ({ data }: { data: Omit<RebateRow, "id"> }) => {
    const id = `r-${rebates.length + 1}`
    const row: RebateRow = {
      id,
      contractId: String(data.contractId),
      facilityId: String(data.facilityId),
      rebateEarned: Number(data.rebateEarned ?? 0),
      rebateCollected: Number(data.rebateCollected ?? 0),
      payPeriodStart:
        data.payPeriodStart instanceof Date
          ? data.payPeriodStart
          : new Date(String(data.payPeriodStart)),
      payPeriodEnd:
        data.payPeriodEnd instanceof Date
          ? data.payPeriodEnd
          : new Date(String(data.payPeriodEnd)),
      collectionDate:
        data.collectionDate == null
          ? null
          : data.collectionDate instanceof Date
            ? data.collectionDate
            : new Date(String(data.collectionDate)),
      notes: data.notes == null ? null : String(data.notes),
    }
    rebates.push(row)
    return row
  },
)

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: (a: { where: { id: string } }) =>
        contractFindUniqueOrThrow(a),
    },
    rebate: {
      findFirst: (a: Parameters<typeof rebateFindFirst>[0]) =>
        rebateFindFirst(a),
      update: (a: Parameters<typeof rebateUpdate>[0]) => rebateUpdate(a),
      create: (a: Parameters<typeof rebateCreate>[0]) => rebateCreate(a),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/serialize", () => ({ serialize: <T,>(x: T) => x }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { createContractTransaction } from "@/lib/actions/contract-periods"

beforeEach(() => {
  vi.clearAllMocks()
  rebates = []
  contracts = []
})

function seedContract(): string {
  const id = `c-${contracts.length + 1}`
  contracts.push({ id, facilityId: "fac-test" })
  return id
}

function seedEarnedPeriod(opts: {
  contractId: string
  earned: number
  start: string
  end: string
}): string {
  const id = `r-${rebates.length + 1}`
  rebates.push({
    id,
    contractId: opts.contractId,
    facilityId: "fac-test",
    rebateEarned: opts.earned,
    rebateCollected: 0,
    payPeriodStart: new Date(opts.start),
    payPeriodEnd: new Date(opts.end),
    collectionDate: null,
    notes: "[auto-accrual]",
  })
  return id
}

describe("createContractTransaction — collected rebate auto-match", () => {
  it("when no windowed period exists, falls back to OLDEST uncollected earned row instead of orphan", async () => {
    const contractId = seedContract()
    // Three earned periods, all uncollected. Collection logged outside
    // every window — must reconcile against the OLDEST one (Q1 2025),
    // NOT spawn a parallel out-of-band row.
    const oldest = seedEarnedPeriod({
      contractId,
      earned: 254860,
      start: "2025-01-01",
      end: "2025-03-31",
    })
    seedEarnedPeriod({
      contractId,
      earned: 254860,
      start: "2025-04-01",
      end: "2025-06-30",
    })
    seedEarnedPeriod({
      contractId,
      earned: 254860,
      start: "2025-07-01",
      end: "2025-09-30",
    })

    await createContractTransaction({
      contractId,
      type: "rebate",
      rebateKind: "collected",
      amount: 57140,
      description: "Q1 2025 rebate check",
      date: "2026-05-05", // outside every period window
    })

    expect(rebates.length).toBe(3) // no orphan was created
    const updated = rebates.find((r) => r.id === oldest)!
    expect(updated.rebateCollected).toBe(57140)
    expect(updated.collectionDate?.toISOString().slice(0, 10)).toBe(
      "2026-05-05",
    )
    expect(updated.rebateEarned).toBe(254860) // engine value untouched
    expect(updated.notes).toMatch(/Collected/)
  })

  it("when a windowed period exists, prefers it over older uncollected rows", async () => {
    const contractId = seedContract()
    const older = seedEarnedPeriod({
      contractId,
      earned: 100000,
      start: "2025-01-01",
      end: "2025-03-31",
    })
    const inWindow = seedEarnedPeriod({
      contractId,
      earned: 50000,
      start: "2026-04-01",
      end: "2026-06-30",
    })

    await createContractTransaction({
      contractId,
      type: "rebate",
      rebateKind: "collected",
      amount: 12345,
      description: "Q2 2026 rebate check",
      date: "2026-05-05",
    })

    const inWindowRow = rebates.find((r) => r.id === inWindow)!
    expect(inWindowRow.rebateCollected).toBe(12345)
    // Older Q1 2025 row was NOT touched
    const olderRow = rebates.find((r) => r.id === older)!
    expect(olderRow.rebateCollected).toBe(0)
  })

  it("creates an out-of-band orphan only when no earned uncollected rows exist on the contract", async () => {
    const contractId = seedContract() // no earned periods at all

    await createContractTransaction({
      contractId,
      type: "rebate",
      rebateKind: "collected",
      amount: 5000,
      description: "ad-hoc collection",
      date: "2026-05-05",
    })

    expect(rebates.length).toBe(1)
    const orphan = rebates[0]
    expect(orphan.rebateEarned).toBe(0)
    expect(orphan.rebateCollected).toBe(5000)
    expect(orphan.notes).toMatch(/\[out-of-band\]/)
  })
})
