/**
 * Charles 2026-04-25: PO rebate dispatcher tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { findManyMock, deleteManyMock, createManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    purchaseOrder: { findMany: findManyMock },
    rebate: { deleteMany: deleteManyMock, createMany: createManyMock },
  },
}))

import { recomputePoAccrualForTerm } from "@/lib/actions/contracts/recompute-po-accrual"

const TERM_BASE = {
  id: "term-1",
  rebateMethod: "cumulative",
  evaluationPeriod: "annual",
  effectiveStart: new Date(Date.UTC(2025, 0, 1)),
  effectiveEnd: new Date(Date.UTC(2026, 11, 31)),
  // PO tiers: spendMin/spendMax interpreted as PO COUNTS;
  // rebateValue is dollars per PO at this tier.
  tiers: [
    {
      tierNumber: 1,
      tierName: "Tier 1",
      spendMin: 0,
      spendMax: 9,
      rebateValue: 50,
    },
    {
      tierNumber: 2,
      tierName: "Tier 2",
      spendMin: 10,
      spendMax: null,
      rebateValue: 200,
    },
  ],
}

beforeEach(() => {
  findManyMock.mockReset()
  deleteManyMock.mockReset().mockResolvedValue({ count: 0 })
  createManyMock.mockReset().mockResolvedValue({ count: 0 })
})

describe("recomputePoAccrualForTerm", () => {
  it("counts POs and applies cumulative tier rate", async () => {
    // 12 POs in year 1 → tier 2 (≥10) → 12 × $200 = $2,400.
    findManyMock.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `po-${i}`,
        orderDate: new Date(Date.UTC(2025, 5, 1 + (i % 28))),
      })),
    )
    const r = await recomputePoAccrualForTerm({
      contractId: "c-1",
      vendorId: "v-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM_BASE,
    })
    expect(r.sumEarned).toBe(2_400)
    expect(deleteManyMock).toHaveBeenCalledOnce()
    expect(createManyMock).toHaveBeenCalledOnce()
  })

  it("queries with submitted/approved/received status and within window", async () => {
    findManyMock.mockResolvedValue([])
    await recomputePoAccrualForTerm({
      contractId: "c-1",
      vendorId: "v-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM_BASE,
    })
    const args = findManyMock.mock.calls[0][0]
    expect(args.where.vendorId).toBe("v-1")
    expect(args.where.facilityId).toBe("f-1")
    expect(args.where.status.in).toEqual([
      "pending",
      "approved",
      "sent",
      "completed",
    ])
  })

  it("idempotent: deletes prior auto-po rows for the term before insert", async () => {
    findManyMock.mockResolvedValue([])
    await recomputePoAccrualForTerm({
      contractId: "c-1",
      vendorId: "v-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM_BASE,
    })
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        contractId: "c-1",
        collectionDate: null,
        notes: { startsWith: "[auto-po-accrual] term:term-1" },
      },
    })
  })

  it("noop when window collapses (term ends before contract starts)", async () => {
    findManyMock.mockResolvedValue([])
    const r = await recomputePoAccrualForTerm({
      contractId: "c-1",
      vendorId: "v-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2030, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2031, 11, 31)),
      term: {
        ...TERM_BASE,
        effectiveStart: new Date(Date.UTC(2020, 0, 1)),
        effectiveEnd: new Date(Date.UTC(2020, 11, 31)),
      },
    })
    expect(r).toEqual({ inserted: 0, sumEarned: 0 })
    expect(findManyMock).not.toHaveBeenCalled()
  })
})
