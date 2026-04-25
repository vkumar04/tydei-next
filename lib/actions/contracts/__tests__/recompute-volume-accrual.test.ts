/**
 * Charles 2026-04-25: volume rebate dispatcher tests.
 *
 * Covers the Prisma → engine bridge that the audit doc 2026-04-19
 * said was missing. We mock prisma.case.findMany + the rebate
 * delete/createMany pair so the test exercises the bridge logic
 * without a DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock factories are hoisted above the surrounding `const`
// declarations, so use `vi.hoisted` to declare the mocks in a
// region that runs first.
const { findManyMock, deleteManyMock, createManyMock } = vi.hoisted(() => {
  return {
    findManyMock: vi.fn(),
    deleteManyMock: vi.fn(),
    createManyMock: vi.fn(),
  }
})

vi.mock("@/lib/db", () => ({
  prisma: {
    case: { findMany: findManyMock },
    rebate: { deleteMany: deleteManyMock, createMany: createManyMock },
  },
}))

import { recomputeVolumeAccrualForTerm } from "@/lib/actions/contracts/recompute-volume-accrual"

const TERM_BASE = {
  id: "term-1",
  cptCodes: ["27447"], // Total Knee Arthroplasty
  rebateMethod: "cumulative",
  evaluationPeriod: "annual",
  effectiveStart: new Date(Date.UTC(2025, 0, 1)),
  effectiveEnd: new Date(Date.UTC(2026, 11, 31)),
  // Volume tiers: spendMin/spendMax are interpreted as OCCURRENCE counts
  // for volume rebates. rebateValue is dollars per occurrence at this tier.
  tiers: [
    {
      tierNumber: 1,
      tierName: "Tier 1",
      spendMin: 0,
      spendMax: 49,
      rebateValue: 100,
    },
    {
      tierNumber: 2,
      tierName: "Tier 2",
      spendMin: 50,
      spendMax: null,
      rebateValue: 250,
    },
  ],
}

beforeEach(() => {
  findManyMock.mockReset()
  deleteManyMock.mockReset().mockResolvedValue({ count: 0 })
  createManyMock.mockReset().mockResolvedValue({ count: 0 })
})

describe("recomputeVolumeAccrualForTerm", () => {
  it("noop when the term has no CPT codes", async () => {
    const r = await recomputeVolumeAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: { ...TERM_BASE, cptCodes: [] },
    })
    expect(r).toEqual({ inserted: 0, sumEarned: 0 })
    expect(findManyMock).not.toHaveBeenCalled()
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it("counts CPT occurrences and persists at top-tier rate", async () => {
    // 60 cases, each with the matching CPT once → 60 occurrences →
    // tier 2 (≥50) → 60 × $250 = $15,000.
    findManyMock.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => ({
        id: `case-${i}`,
        dateOfSurgery: new Date(Date.UTC(2025, 5, 1 + (i % 28))),
        procedures: [{ cptCode: "27447" }],
      })),
    )
    const r = await recomputeVolumeAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM_BASE,
    })
    expect(r.inserted).toBeGreaterThan(0)
    expect(r.sumEarned).toBe(15_000)
    expect(deleteManyMock).toHaveBeenCalledOnce()
    expect(createManyMock).toHaveBeenCalledOnce()
    const writeArgs = createManyMock.mock.calls[0][0]
    expect(writeArgs.data[0].notes).toContain("[auto-volume-accrual] term:term-1")
  })

  it("dedupes occurrences by caseId+cptCode (one per case)", async () => {
    // Same case, CPT recorded twice (e.g. two billing rows) → counts as 1.
    // Two cases each with the CPT twice → 2 occurrences total, tier 1 ($100).
    findManyMock.mockResolvedValue([
      {
        id: "case-A",
        dateOfSurgery: new Date(Date.UTC(2025, 5, 1)),
        procedures: [{ cptCode: "27447" }, { cptCode: "27447" }],
      },
      {
        id: "case-B",
        dateOfSurgery: new Date(Date.UTC(2025, 5, 2)),
        procedures: [{ cptCode: "27447" }, { cptCode: "27447" }],
      },
    ])
    const r = await recomputeVolumeAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM_BASE,
    })
    // 2 occurrences × $100/occurrence (tier 1) = $200.
    expect(r.sumEarned).toBe(200)
  })

  it("filters out CPT codes not in the term's cptCodes list", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "case-A",
        dateOfSurgery: new Date(Date.UTC(2025, 5, 1)),
        procedures: [{ cptCode: "27447" }, { cptCode: "OTHER" }],
      },
    ])
    const r = await recomputeVolumeAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM_BASE,
    })
    // 1 occurrence × $100 = $100. The OTHER CPT shouldn't bump us
    // to tier 2 even though there's a second procedure on the case.
    expect(r.sumEarned).toBe(100)
  })

  it("respects the term's effective window when filtering cases", async () => {
    // Two cases — one inside the window, one before.
    findManyMock.mockImplementation(
      async ({ where }: { where: { dateOfSurgery: { gte: Date } } }) => {
        // Honor the date filter so we only return the in-window one.
        const inWindow = {
          id: "case-in",
          dateOfSurgery: new Date(Date.UTC(2025, 5, 1)),
          procedures: [{ cptCode: "27447" }],
        }
        return where.dateOfSurgery.gte.getTime() <= inWindow.dateOfSurgery.getTime()
          ? [inWindow]
          : []
      },
    )
    const r = await recomputeVolumeAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM_BASE,
    })
    expect(r.sumEarned).toBe(100) // 1 occurrence × $100 (tier 1)
  })

  it("idempotent: prior auto-volume rows for the term are deleted before insert", async () => {
    findManyMock.mockResolvedValue([])
    await recomputeVolumeAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2026, 11, 31)),
      term: TERM_BASE,
    })
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        contractId: "c-1",
        collectionDate: null,
        notes: { startsWith: "[auto-volume-accrual] term:term-1" },
      },
    })
  })
})
