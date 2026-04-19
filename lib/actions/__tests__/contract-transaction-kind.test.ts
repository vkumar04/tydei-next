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

const { rebateCreateMock, periodCreateMock, contractFindMock } = vi.hoisted(
  () => ({
    rebateCreateMock: vi.fn(),
    periodCreateMock: vi.fn(),
    contractFindMock: vi.fn(),
  }),
)

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: contractFindMock },
    rebate: { create: rebateCreateMock },
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

  it("writes a pure-collected row when rebateKind='collected' (no earned contribution)", async () => {
    await createContractTransaction({
      contractId: "c-1",
      type: "rebate",
      rebateKind: "collected",
      amount: 90000,
      description: "Mar 31 2026 payment received",
      date: "2026-03-31",
    })

    expect(rebateCreateMock).toHaveBeenCalledTimes(1)
    const data = rebateCreateMock.mock.calls[0][0].data

    // The bug: old code set rebateEarned=amount too. Regression guard.
    expect(data.rebateEarned).toBe(0)
    expect(data.rebateCollected).toBe(90000)
    expect(data.collectionDate).toBeInstanceOf(Date)
    // collectionDate must equal the transaction date so the "Collected"
    // status badge drives off a real timestamp.
    expect((data.collectionDate as Date).toISOString()).toBe(
      new Date("2026-03-31").toISOString(),
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

  it("a collected row is NOT included in the getContract rebateEarned aggregate", async () => {
    // The "Rebates Earned" aggregate in getContract sums `rebateEarned`
    // where payPeriodEnd <= today (see lib/actions/contracts.ts and
    // lib/actions/__tests__/get-contract-rebate-ytd.test.ts). A collected
    // row persists with rebateEarned=0, so it contributes 0 by construction.
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

  it("ignores quantity on a collected row (units don't apply to a payment entry)", async () => {
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
