/**
 * Regression tests for `createContractTransaction` earned vs collected split
 * (Charles R5.34).
 *
 * Feedback: "When I entered in a rebate to collect it goes into the rebate
 * earned number and just adds to it." Previously the action wrote `amount`
 * into BOTH `rebateEarned` and `rebateCollected`, so every payment-received
 * row double-counted into "Rebates Earned". The fix splits on `rebateKind`:
 *
 *   - kind="earned"    → rebateEarned=amount, rebateCollected=0, collectionDate=null
 *   - kind="collected" → rebateEarned=0, rebateCollected=amount, collectionDate=txnDate
 *
 * These tests lock the Prisma row shape on each code path so the fix
 * doesn't silently regress.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  rebateCreateMock,
  rebateFindFirstMock,
  rebateUpdateMock,
  periodCreateMock,
  contractFindMock,
} = vi.hoisted(() => ({
  rebateCreateMock: vi.fn(),
  rebateFindFirstMock: vi.fn(),
  rebateUpdateMock: vi.fn(),
  periodCreateMock: vi.fn(),
  contractFindMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: contractFindMock },
    rebate: {
      create: rebateCreateMock,
      findFirst: rebateFindFirstMock,
      update: rebateUpdateMock,
    },
    contractPeriod: { create: periodCreateMock },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(v: T) => v,
}))

import { createContractTransaction } from "@/lib/actions/contract-periods"

beforeEach(() => {
  vi.clearAllMocks()
  contractFindMock.mockResolvedValue({ id: "c-1" })
  rebateCreateMock.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "r-new",
      ...data,
    }),
  )
  rebateUpdateMock.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: { id: string }
      data: Record<string, unknown>
    }) => ({
      id: where.id,
      ...data,
    }),
  )
  // Default: no earned row exists, so collections fall through to the
  // legacy pure-collection create path. Tests that want the W1.W-C1
  // update-in-place path override this per-test.
  rebateFindFirstMock.mockResolvedValue(null)
  periodCreateMock.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "p-new",
      ...data,
    }),
  )
})

describe("createContractTransaction — earned vs collected split (Charles R5.34)", () => {
  it("writes a pure-earned row when rebateKind='earned'", async () => {
    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "earned",
      amount: 90000,
      description: "Q1 2026 accrual",
      date: "2026-03-31",
    })

    expect(rebateCreateMock).toHaveBeenCalledTimes(1)
    const data = rebateCreateMock.mock.calls[0][0].data
    expect(data.rebateEarned).toBe(90000)
    expect(data.rebateCollected).toBe(0)
    expect(data.collectionDate).toBeNull()
  })

  it("falls back to a pure-collected row when no earned row exists (out-of-band)", async () => {
    // rebateFindFirstMock default is null → no earned row to match.
    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "collected",
      amount: 90000,
      description: "Mar 31 2026 payment received",
      date: "2026-03-31",
    })

    expect(rebateUpdateMock).not.toHaveBeenCalled()
    expect(rebateCreateMock).toHaveBeenCalledTimes(1)
    const data = rebateCreateMock.mock.calls[0][0].data

    // The R5.34 fix still holds for the out-of-band path.
    expect(data.rebateEarned).toBe(0)
    expect(data.rebateCollected).toBe(90000)
    expect(data.collectionDate).toBeInstanceOf(Date)
    expect((data.collectionDate as Date).toISOString()).toBe(
      new Date("2026-03-31").toISOString(),
    )
    // Out-of-band rows are flagged in notes so the user can tell them
    // apart from the paired earned/collected rows.
    expect(String(data.notes)).toMatch(/\[out-of-band\]/)
  })

  it("updates the existing earned row in place when rebateKind='collected' and an earned row exists (Charles W1.W-C1)", async () => {
    // Simulate an existing earned-uncollected row on this contract.
    rebateFindFirstMock.mockResolvedValueOnce({
      id: "r-earned-1",
      rebateEarned: 90000,
      rebateCollected: 0,
      collectionDate: null,
      notes: "[auto-accrual] Q1 2026 · tier 2 @ 3% on $3,000,000",
    })

    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "collected",
      amount: 90000,
      description: "Q1 rebate check received",
      date: "2026-03-31",
    })

    // CRITICAL: no new row is created — we UPDATE the existing earned
    // row so the ledger renders one line with Earned / Collected /
    // Outstanding instead of two parallel rows.
    expect(rebateCreateMock).not.toHaveBeenCalled()
    expect(rebateUpdateMock).toHaveBeenCalledTimes(1)
    const call = rebateUpdateMock.mock.calls[0][0]
    expect(call.where).toEqual({ id: "r-earned-1" })
    expect(call.data.rebateCollected).toBe(90000)
    expect(call.data.collectionDate).toBeInstanceOf(Date)
    expect((call.data.collectionDate as Date).toISOString()).toBe(
      new Date("2026-03-31").toISOString(),
    )
    // rebateEarned is NOT touched — the accrual stays as the ledger's
    // record of what was earned.
    expect(call.data.rebateEarned).toBeUndefined()
  })

  it("accumulates into existing rebateCollected on partial-collection updates", async () => {
    rebateFindFirstMock.mockResolvedValueOnce({
      id: "r-earned-1",
      rebateEarned: 90000,
      rebateCollected: 30000,
      collectionDate: null,
      notes: "[auto-accrual] Q1 2026",
    })

    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "collected",
      amount: 60000,
      description: "second half of Q1 rebate",
      date: "2026-04-05",
    })

    const call = rebateUpdateMock.mock.calls[0][0]
    // Prior $30,000 + new $60,000 = $90,000 fully collected.
    expect(call.data.rebateCollected).toBe(90000)
  })

  it("honors an explicit rebateId when the user picks a specific earned period from the dropdown", async () => {
    // findFirst is called with `where.id` when rebateId is supplied.
    rebateFindFirstMock.mockImplementationOnce(
      async ({ where }: { where: { id?: string } }) => {
        if (where.id === "r-picked") {
          return {
            id: "r-picked",
            rebateEarned: 45000,
            rebateCollected: 0,
            collectionDate: null,
            notes: "Q2 accrual",
          }
        }
        return null
      },
    )

    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "collected",
      amount: 45000,
      description: "Q2 check",
      date: "2026-07-10",
      rebateId: "r-picked",
    })

    expect(rebateUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r-picked" } }),
    )
  })

  it("defaults rebateKind to 'earned' when the caller omits it (pre-R5.34 callers)", async () => {
    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      amount: 1234,
      description: "legacy caller",
      date: "2026-03-31",
    })

    const data = rebateCreateMock.mock.calls[0][0].data
    expect(data.rebateEarned).toBe(1234)
    expect(data.rebateCollected).toBe(0)
    expect(data.collectionDate).toBeNull()
  })

  it("a pure-collected fallback row is NOT included in the getContract rebateEarned aggregate", async () => {
    // The "Rebates Earned" aggregate in getContract sums `rebateEarned`
    // where payPeriodEnd <= today (see lib/actions/contracts.ts and
    // lib/actions/__tests__/get-contract-rebate-ytd.test.ts). The
    // out-of-band fallback row persists with rebateEarned=0, so it
    // contributes 0 by construction.
    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "collected",
      amount: 90000,
      description: "payment",
      date: "2026-03-31",
    })

    const data = rebateCreateMock.mock.calls[0][0].data
    // Simulate the aggregate filter.
    const earnedContribution =
      (data.payPeriodEnd as Date) <= new Date()
        ? Number(data.rebateEarned)
        : 0
    expect(earnedContribution).toBe(0)
  })

  it("ignores quantity on a collected fallback row (units don't apply to a payment entry)", async () => {
    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "collected",
      amount: 90000,
      description: "payment",
      date: "2026-03-31",
      quantity: 500,
    })

    const data = rebateCreateMock.mock.calls[0][0].data
    // Notes must not carry a "(Qty: …)" suffix on a collected row.
    expect(String(data.notes)).not.toMatch(/Qty:/)
  })

  it("preserves quantity suffix on an earned row", async () => {
    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "earned",
      amount: 1500,
      description: "120 units @ $12.50",
      date: "2026-03-31",
      quantity: 120,
    })

    const data = rebateCreateMock.mock.calls[0][0].data
    expect(String(data.notes)).toMatch(/Qty: 120/)
  })
})
