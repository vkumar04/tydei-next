/**
 * Charles 2026-04-25: invoice rebate dispatcher tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { findManyMock, deleteManyMock, createManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findMany: findManyMock },
    rebate: { deleteMany: deleteManyMock, createMany: createManyMock },
  },
}))

import { recomputeInvoiceAccrualForTerm } from "@/lib/contracts/recompute/invoice"

const TERM = {
  id: "term-1",
  rebateMethod: "cumulative",
  evaluationPeriod: "annual",
  effectiveStart: new Date(Date.UTC(2025, 0, 1)),
  effectiveEnd: new Date(Date.UTC(2026, 11, 31)),
  // Tier 1: 0-19 invoices → $25 each. Tier 2: 20+ → $75 each.
  tiers: [
    { tierNumber: 1, tierName: "T1", spendMin: 0, spendMax: 19, rebateValue: 25 },
    { tierNumber: 2, tierName: "T2", spendMin: 20, spendMax: null, rebateValue: 75 },
  ],
}

beforeEach(() => {
  findManyMock.mockReset()
  deleteManyMock.mockReset().mockResolvedValue({ count: 0 })
  createManyMock.mockReset().mockResolvedValue({ count: 0 })
})

describe("recomputeInvoiceAccrualForTerm", () => {
  it("counts invoices and applies cumulative tier rate", async () => {
    // 25 invoices in year 1 → tier 2 (≥20) → 25 × $75 = $1,875.
    findManyMock.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        id: `inv-${i}`,
        invoiceDate: new Date(Date.UTC(2025, 5, 1 + (i % 28))),
      })),
    )
    const r = await recomputeInvoiceAccrualForTerm({
      contractId: "c-1",
      vendorId: "v-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM,
    })
    expect(r.sumEarned).toBe(1_875)
  })

  it("excludes cancelled invoices from the query", async () => {
    findManyMock.mockResolvedValue([])
    await recomputeInvoiceAccrualForTerm({
      contractId: "c-1",
      vendorId: "v-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM,
    })
    const where = findManyMock.mock.calls[0][0].where
    expect(where.NOT).toEqual({ status: "cancelled" })
  })

  it("idempotent: deletes prior auto-invoice rows for the term", async () => {
    findManyMock.mockResolvedValue([])
    await recomputeInvoiceAccrualForTerm({
      contractId: "c-1",
      vendorId: "v-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM,
    })
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        contractId: "c-1",
        collectionDate: null,
        notes: { startsWith: "[auto-invoice-accrual] term:term-1" },
      },
    })
  })

  it("annotates notes with invoice count + dollar amount", async () => {
    findManyMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `inv-${i}`,
        invoiceDate: new Date(Date.UTC(2025, 5, 1 + i)),
      })),
    )
    await recomputeInvoiceAccrualForTerm({
      contractId: "c-1",
      vendorId: "v-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      term: TERM,
    })
    expect(createManyMock).toHaveBeenCalledOnce()
    const data = createManyMock.mock.calls[0][0].data
    // 5 invoices × $25/inv (tier 1) = $125.
    expect(data[0].notes).toContain("5 invoices")
    expect(data[0].notes).toContain("$125.00")
  })
})
