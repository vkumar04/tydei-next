import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `getPendingContractDcfBundle` — DCF for a submission that is not an approved
 * Contract yet.
 *
 * A PendingContract has no ContractTerm/ContractTier ROWS, but the submission
 * form persists the whole ladder into its `terms` JSON. The premise that a
 * ladder cannot exist pre-approval is wrong, and this pins that: the JSON path
 * produces the same engine-unit ladder the relational path does.
 *
 * `linked` is always empty — ContractDcfLink.contractId is a hard FK to
 * Contract, so nothing can be persisted against a submission.
 */

const { pendingFindFirstMock, requireVendorMock } = vi.hoisted(() => ({
  pendingFindFirstMock: vi.fn(),
  requireVendorMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    pendingContract: { findFirst: pendingFindFirstMock },
    contract: { findFirst: vi.fn() },
    dividendProposal: { findFirst: vi.fn() },
    contractDcfLink: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}))
vi.mock("@/lib/actions/auth", () => ({ requireVendor: requireVendorMock }))
vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { getPendingContractDcfBundle } from "@/lib/actions/contract-dcf-links"
import { projectRebateAccrualSchedule } from "@/lib/contracts/rebate-accrual-schedule"

/** The shape the vendor submission form actually persists. */
const PENDING_ROW = {
  effectiveDate: new Date("2026-09-01T00:00:00Z"),
  expirationDate: new Date("2031-09-01T00:00:00Z"),
  totalValue: 4_000_000,
  annualValue: 800_000,
  terms: [
    {
      termName: "Annual Spend Rebate",
      termType: "spend_rebate",
      rebateMethod: "cumulative",
      evaluationPeriod: "annual",
      tiers: [
        // Percent tiers are stored as FRACTIONS, same as ContractTier.
        { tierNumber: 1, spendMin: 0, spendMax: 500_000, rebateValue: 0.02, rebateType: "percent_of_spend" },
        { tierNumber: 2, spendMin: 500_000, spendMax: 1_000_000, rebateValue: 0.04, rebateType: "percent_of_spend" },
        { tierNumber: 3, spendMin: 1_000_000, spendMax: null, rebateValue: 0.06, rebateType: "percent_of_spend" },
      ],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  requireVendorMock.mockResolvedValue({ vendor: { id: "v-1" }, user: { id: "u-1" } })
  pendingFindFirstMock.mockResolvedValue(PENDING_ROW)
})

describe("getPendingContractDcfBundle", () => {
  it("scopes the read to the caller's own vendor", async () => {
    await getPendingContractDcfBundle("pc-1")
    const args = pendingFindFirstMock.mock.calls[0]![0] as {
      where: Record<string, unknown>
    }
    expect(args.where).toEqual({ id: "pc-1", vendorId: "v-1" })
  })

  it("builds an engine-unit ladder from the terms JSON", async () => {
    const bundle = await getPendingContractDcfBundle("pc-1")
    expect(bundle.ladder).not.toBeNull()
    // Fractions scaled to percent, no flat-dollar component.
    expect(bundle.ladder!.tiers).toEqual([
      { spendMin: 0, spendMax: 500_000, rebateValue: 2, fixedRebateAmount: null },
      { spendMin: 500_000, spendMax: 1_000_000, rebateValue: 4, fixedRebateAmount: null },
      { spendMin: 1_000_000, spendMax: null, rebateValue: 6, fixedRebateAmount: null },
    ])
    expect(bundle.ladder!.rebateMethod).toBe("cumulative")
    expect(bundle.ladder!.termName).toBe("Annual Spend Rebate")
  })

  it("uses annualValue as the year-1 spend basis", async () => {
    const bundle = await getPendingContractDcfBundle("pc-1")
    expect(bundle.baseAnnualSpend).toBe(800_000)
  })

  it("falls back to totalValue ÷ term years when annualValue is unset", async () => {
    pendingFindFirstMock.mockResolvedValue({ ...PENDING_ROW, annualValue: null })
    const bundle = await getPendingContractDcfBundle("pc-1")
    // 2026-09-01 → 2031-09-01 is ~5 years, so ~$800k/yr either way.
    expect(bundle.baseAnnualSpend).toBeGreaterThan(780_000)
    expect(bundle.baseAnnualSpend).toBeLessThan(820_000)
  })

  it("projects the same figures the surface renders", async () => {
    const bundle = await getPendingContractDcfBundle("pc-1")
    const g = 0.03
    const schedule = projectRebateAccrualSchedule({
      tiers: bundle.ladder!.tiers,
      periodProjections: Array.from({ length: 5 }, (_, i) => ({
        periodNumber: i + 1,
        projectedSpend: bundle.baseAnnualSpend * (1 + g) ** i,
      })),
      method: bundle.ladder!.rebateMethod,
      boundaryRule: bundle.ladder!.boundaryRule,
      spendBaseline: bundle.ladder!.spendBaseline,
      growthOnly: bundle.ladder!.growthOnly,
      periodCap: bundle.ladder!.annualSpendCap,
    })
    // Y1 $800,000 cumulative sits in T2 (4%); Y2 crosses $1M into T3 (6%), so
    // the delta carries the retroactive uplift on year 1.
    expect(Math.round(schedule[0]!.projectedRebate)).toBe(32_000)
    expect(Math.round(schedule[1]!.projectedRebate)).toBe(65_440)
    expect(schedule[0]!.achievedTier).toBe(2)
    expect(schedule[1]!.achievedTier).toBe(3)
  })

  it("never returns persisted links", async () => {
    const bundle = await getPendingContractDcfBundle("pc-1")
    expect(bundle.linked).toEqual([])
  })

  it("yields no ladder when the submission carries only a stub term", async () => {
    // What the seed writes: a term with no tiers array at all.
    pendingFindFirstMock.mockResolvedValue({
      ...PENDING_ROW,
      terms: [{ termType: "spend_rebate", tierCount: 2, baselineSpend: 200_000 }],
    })
    const bundle = await getPendingContractDcfBundle("pc-1")
    expect(bundle.ladder).toBeNull()
    expect(bundle.baseAnnualSpend).toBe(800_000)
  })

  it("rejects a filter-object id before touching Prisma", async () => {
    await expect(
      getPendingContractDcfBundle({ not: "" } as unknown as string),
    ).rejects.toThrow()
    expect(pendingFindFirstMock).not.toHaveBeenCalled()
  })

  it("throws when the submission is not the caller's", async () => {
    pendingFindFirstMock.mockResolvedValue(null)
    await expect(getPendingContractDcfBundle("pc-1")).rejects.toThrow(
      /Submission not found/,
    )
  })
})
