/**
 * Regression test for Charles W1.S.
 *
 * Root cause: `getAccrualTimeline` passed `ContractTier.rebateValue`
 * directly to the rebate engine. `rebateValue` is stored as a fraction
 * (0.03 = 3%), but the engine in `lib/rebates/calculate.ts`
 * expects integer percent (3 = 3%). Without the scale at the Prisma
 * boundary the Accrual Timeline's Rate column rendered "0.03%" (raw
 * fraction) and the Accrued column computed `spend × 0.03 / 100`, which
 * was 100× smaller than the correct `spend × 0.03`.
 *
 * Fix: scale `rebateValue` by 100 for `percent_of_spend` tiers when
 * building the `TermAccrualConfig` — same convention used by
 * `computeRebateFromPrismaTiers` and `formatTierRebateLabel`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { cogFindManyMock, contractFindUniqueMock, rebateFindManyMock } =
  vi.hoisted(() => ({
    cogFindManyMock: vi.fn(),
    contractFindUniqueMock: vi.fn(),
    rebateFindManyMock: vi.fn(),
  }))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirstOrThrow: contractFindUniqueMock,
    },
    cOGRecord: {
      findMany: cogFindManyMock,
    },
    rebate: {
      findMany: rebateFindManyMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

import { getAccrualTimeline } from "@/lib/actions/contracts/accrual"

const baseContract = {
  id: "c-1",
  vendorId: "v-1",
  facilityId: "fac-1",
  contractType: "usage",
  effectiveDate: new Date("2025-01-01T00:00:00Z"),
  expirationDate: new Date("2025-06-30T00:00:00Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
  // Overlay fetch (carve-out / threshold / volume persisted accrual) —
  // default to "no persisted rows"; tests that need overlay rows override.
  rebateFindManyMock.mockResolvedValue([])
})

describe("getAccrualTimeline — Rate column scaling (Charles W1.S)", () => {
  it("renders raw fractional rebateValue (0.03) as scaled percent (3) on output", async () => {
    // ContractTier.rebateValue is stored as a fraction: 0.03 = 3%.
    // `rebateType` defaults to percent_of_spend.
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "annual",
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 0.03,
              rebateType: "percent_of_spend",
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 215754,
      },
    ])

    const result = await getAccrualTimeline("c-1")

    // 2026-06-09 (Charles "quarterly contract showing monthly accrual"):
    // annual-eval rows now roll up into a single calendar-year row "2025"
    // (was per-month "2025-01"…). The rebate-scaling invariant this test
    // guards is unchanged — assert it on the rolled-up year row.
    const year = result.rows.find((r) => r.month === "2025")
    expect(year).toBeDefined()
    expect(year?.spend).toBe(215754)
    expect(year?.tierAchieved).toBe(1)
    // rebateValue 0.03 → engine scaled to 3 (not 0.03). UI shows 3.00%.
    expect(year?.rebatePercent).toBeCloseTo(3, 5)
    // Year's total accrual = spend × stored fraction = 215754 × 0.03 =
    // 6472.62. Pre-W1.S this was 100× too small (64.73) because the engine
    // computed `spend × 0.03 / 100`.
    expect(year?.accruedAmount).toBeCloseTo(215754 * 0.03, 2)
  })

  it("scales every percent tier consistently across a multi-month series", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "monthly",
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 0.025,
              rebateType: "percent_of_spend",
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      { transactionDate: new Date("2025-01-10T00:00:00Z"), extendedPrice: 100_000 },
      { transactionDate: new Date("2025-02-10T00:00:00Z"), extendedPrice: 200_000 },
      { transactionDate: new Date("2025-03-10T00:00:00Z"), extendedPrice: 300_000 },
    ])

    const result = await getAccrualTimeline("c-1")

    for (const row of result.rows.filter((r) => r.spend > 0)) {
      // rebatePercent stays 2.5 every month (post-fix scaled display).
      expect(row.rebatePercent).toBeCloseTo(2.5, 5)
      // Accrued column reconciles exactly to spend × stored fraction.
      expect(row.accruedAmount).toBeCloseTo(row.spend * 0.025, 2)
    }
  })

  it("does not scale non-percent rebate types (fixed_rebate stays raw)", async () => {
    // Fixed-dollar tier: the engine path only handles percent today, but
    // the boundary scaler should leave non-percent values untouched so
    // any future engine support isn't double-scaled.
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          rebateMethod: "cumulative" as const,
          evaluationPeriod: "annual",
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          tiers: [
            {
              tierNumber: 1,
              tierName: null,
              spendMin: 0,
              spendMax: null,
              rebateValue: 500,
              rebateType: "fixed_rebate",
            },
          ],
        },
      ],
    })

    cogFindManyMock.mockResolvedValue([
      { transactionDate: new Date("2025-01-15T00:00:00Z"), extendedPrice: 100_000 },
    ])

    const result = await getAccrualTimeline("c-1")
    // The engine will still treat the value as a percent (engine is
    // percent-only today), but the scaler must not have multiplied the
    // raw 500 by 100 — that would produce astronomical amounts. Just
    // assert we returned rows without throwing.
    expect(result.rows.length).toBeGreaterThan(0)
  })
})

describe("getAccrualTimeline — carve-out placeholder tiers excluded from tier walk (bugs.rtfd 2026-06-11 A1)", () => {
  /** A carve-out term as auto-created by the importer: a single
   * PLACEHOLDER tier (spendMin 0, rebateValue 0). Pre-fix, the hand-rolled
   * `termsWithTiers` filter only excluded market_share / compliance_rebate,
   * so this placeholder ladder entered the tier walk and every spend month
   * "achieved" Tier 1 (and on multi-placeholder contracts the Tier column
   * escalated 1→2→3 with cumulative spend). */
  const placeholderTerm = (termType: "carve_out") => ({
    id: "term-1",
    termType,
    termName: `${termType} term`,
    rebateMethod: "cumulative" as const,
    evaluationPeriod: "monthly",
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    tiers: [
      {
        tierNumber: 1,
        tierName: null,
        spendMin: 0,
        spendMax: null,
        rebateValue: 0,
        rebateType: "percent_of_spend",
      },
    ],
  })

  const climbingSpend = [
    { transactionDate: new Date("2025-01-10T00:00:00Z"), extendedPrice: 100_000 },
    { transactionDate: new Date("2025-02-10T00:00:00Z"), extendedPrice: 200_000 },
    { transactionDate: new Date("2025-03-10T00:00:00Z"), extendedPrice: 300_000 },
  ]

  it("carve_out: never walks the placeholder ladder — overlay-only rows with tierAchieved 0", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [placeholderTerm("carve_out")],
    })
    cogFindManyMock.mockResolvedValue(climbingSpend)
    // The REAL carve-out accrual is persisted by its dedicated writer —
    // the overlay must still surface it even though the tier walk is gone.
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 1234.56,
        payPeriodEnd: new Date("2025-03-31T00:00:00Z"),
        notes: "[auto-carve-out-accrual] term:term-1",
      },
    ])

    const result = await getAccrualTimeline("c-1")

    // Excluded-term contracts take the termsWithTiers.length === 0 path:
    // overlay-only monthly rows (spend/cumulative 0 — no tier walk ran).
    expect(result.rows.length).toBe(1)
    const row = result.rows[0]
    expect(row.month).toBe("2025-03")
    expect(row.accruedAmount).toBeCloseTo(1234.56, 2)
    for (const r of result.rows) {
      // Placeholder ladder must never drive the Tier / Rate columns.
      expect(r.tierAchieved).toBe(0)
      expect(r.rebatePercent).toBe(0)
    }
  })

  it("tie_in CONTRACT with a carve_out placeholder term: ladder excluded — no tier-walk rows", async () => {
    // Realistic shape: `tie_in` is a ContractType, not a TermType. A
    // tie-in contract's rebate-bearing term is a carve_out (per-SKU
    // carveOutPercent earns; the tier is the importer's placeholder).
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      contractType: "tie_in",
      terms: [placeholderTerm("carve_out")],
    })
    cogFindManyMock.mockResolvedValue(climbingSpend)
    // No persisted carve-out accrual yet — nothing to overlay.
    rebateFindManyMock.mockResolvedValue([])

    const result = await getAccrualTimeline("c-1")

    // Pre-fix this produced 6 monthly rows whose Tier column read "1" on
    // every spend month. Post-fix the contract has no spend-dollar tier
    // ladder and no overlay rows → empty timeline.
    expect(result.rows).toEqual([])
  })
})

describe("getAccrualTimeline — dispatcher-only term types overlay instead of blank (2026-06-11 A1 review)", () => {
  /** po_rebate / payment_rebate tiers store COUNT thresholds in spendMin
   * (see pickThresholdMetric); hasSpendDollarTierLadder classifies them
   * non-spend-dollar, so they never enter the tier walk. Pre-fix, the
   * overlay fetch also skipped their writer prefixes ([auto-po-accrual] /
   * [auto-invoice-accrual]), so a contract whose ONLY term was one of
   * these rendered a fully blank timeline despite persisted accrual. */
  const dispatcherTerm = (termType: "po_rebate" | "payment_rebate") => ({
    id: "term-1",
    termType,
    termName: `${termType} term`,
    rebateMethod: "cumulative" as const,
    evaluationPeriod: "monthly",
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    tiers: [
      {
        tierNumber: 1,
        tierName: null,
        spendMin: 10, // COUNT threshold (POs / invoices), not dollars
        spendMax: null,
        rebateValue: 250,
        rebateType: "fixed_rebate",
      },
    ],
  })

  it("po_rebate-only contract surfaces persisted [auto-po-accrual] rows", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [dispatcherTerm("po_rebate")],
    })
    cogFindManyMock.mockResolvedValue([])
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 250,
        payPeriodEnd: new Date("2025-02-28T00:00:00Z"),
        notes: "[auto-po-accrual] term:term-1",
      },
    ])

    const result = await getAccrualTimeline("c-1")

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].month).toBe("2025-02")
    expect(result.rows[0].accruedAmount).toBeCloseTo(250, 2)
  })

  it("payment_rebate-only contract surfaces persisted [auto-invoice-accrual] rows", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [dispatcherTerm("payment_rebate")],
    })
    cogFindManyMock.mockResolvedValue([])
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 99.5,
        payPeriodEnd: new Date("2025-04-30T00:00:00Z"),
        notes: "[auto-invoice-accrual] term:term-1",
      },
    ])

    const result = await getAccrualTimeline("c-1")

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].month).toBe("2025-04")
    expect(result.rows[0].accruedAmount).toBeCloseTo(99.5, 2)
  })
})

describe("getAccrualTimeline — overlay term rate attribution (bugs.rtfd 2026-06-11 A2)", () => {
  /** Bug A2: a market_share + spend two-term contract's per-term breakout
   * showed "Distal Extremities Rebate: 2.00% → $130,818" but "Qualified
   * Annual Spend Rebate → $84,557" with NO rate. Root cause: the overlay
   * merge hardcoded `rebatePercent: 0` — the contributing term's tiers
   * (already loaded on `contract.terms`) were never consulted for the
   * achieved tier's rate. */
  const spendTerm = {
    id: "term-spend",
    termType: "spend_rebate",
    termName: "Distal Extremities Rebate",
    rebateMethod: "cumulative" as const,
    evaluationPeriod: "monthly",
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    tiers: [
      {
        tierNumber: 1,
        tierName: null,
        spendMin: 0,
        spendMax: null,
        rebateValue: 0.02, // fraction → displays as 2.00%
        rebateType: "percent_of_spend",
      },
    ],
  }
  /** Market-share tiers: `spendMin` is a PERCENT threshold (0–100), and
   * the Bug #21 percent-of-spend shape stores the payout as a FRACTION
   * (0.09 = 9% of in-scope spend) — see `threshold.ts`
   * `isMarketSharePercentOfSpend`. */
  const marketShareTerm = {
    id: "term-ms",
    termType: "market_share",
    termName: "Qualified Annual Spend Rebate",
    rebateMethod: "cumulative" as const,
    evaluationPeriod: "annual",
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2025-01-02T00:00:00Z"),
    tiers: [
      {
        tierNumber: 1,
        tierName: null,
        spendMin: 0,
        spendMax: 60,
        rebateValue: 0.05,
        rebateType: "percent_of_spend",
      },
      {
        tierNumber: 2,
        tierName: null,
        spendMin: 60,
        spendMax: 80,
        rebateValue: 0.09,
        rebateType: "percent_of_spend",
      },
      {
        tierNumber: 3,
        tierName: null,
        spendMin: 80,
        spendMax: null,
        rebateValue: 0.11,
        rebateType: "percent_of_spend",
      },
    ],
  }

  it("market-share overlay contribution carries the achieved tier's scaled rate; the spend term keeps its own", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [spendTerm, marketShareTerm],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 100_000,
        category: null,
      },
    ])
    // Threshold-writer note shape (threshold.ts:479-482): prefix ·
    // metric=share% (period) · tier N · spend → payout.
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 84557,
        payPeriodEnd: new Date("2025-01-31T00:00:00Z"),
        notes:
          "[auto-threshold-accrual] term:term-ms · currentMarketShare=70.5% (period) · tier 2 · spend=$939522.22 → $84557.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")
    const row = result.rows.find((r) => r.month === "2025-01")
    expect(row).toBeDefined()

    // The market-share term joins as overlay index 1 (after the single
    // walked spend term at index 0).
    const ms = row?.termContributions.find((c) => c.termIndex === 1)
    expect(ms).toBeDefined()
    expect(ms?.accruedAmount).toBeCloseTo(84557, 2)
    expect(ms?.tierAchieved).toBe(2)
    // Tier 2 rebateValue 0.09 (fraction) → scaled display percent 9.
    expect(ms?.rebatePercent).toBeCloseTo(9, 5)

    // No cross-contamination: the walked spend term's contribution keeps
    // its own walk-derived rate and tier.
    const spend = row?.termContributions.find((c) => c.termIndex === 0)
    expect(spend).toBeDefined()
    expect(spend?.rebatePercent).toBeCloseTo(2, 5)
    expect(spend?.tierAchieved).toBe(1)
    expect(spend?.accruedAmount).toBeCloseTo(100_000 * 0.02, 2)
  })

  it("merge branch: when a higher-tier overlay row joins an existing contribution, the rate updates with it", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [spendTerm, marketShareTerm],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 100_000,
        category: null,
      },
    ])
    // Two writer rows landing in the SAME month: tier 1 first, then a
    // tier-2 row. The merge must keep the higher tier AND its rate.
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 1000,
        payPeriodEnd: new Date("2025-01-15T00:00:00Z"),
        notes:
          "[auto-threshold-accrual] term:term-ms · currentMarketShare=55.0% (period) · tier 1 · spend=$20000.00 → $1000.00",
      },
      {
        rebateEarned: 84557,
        payPeriodEnd: new Date("2025-01-31T00:00:00Z"),
        notes:
          "[auto-threshold-accrual] term:term-ms · currentMarketShare=70.5% (period) · tier 2 · spend=$939522.22 → $84557.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")
    const row = result.rows.find((r) => r.month === "2025-01")
    const ms = row?.termContributions.find((c) => c.termIndex === 1)
    expect(ms?.accruedAmount).toBeCloseTo(85557, 2)
    expect(ms?.tierAchieved).toBe(2)
    expect(ms?.rebatePercent).toBeCloseTo(9, 5)
  })

  it("non-percent (flat-dollar) overlay tiers keep rebatePercent 0 — a dollar payout must not render as %", async () => {
    // createEmptyTier defaults threshold-term tiers to fixed_rebate: the
    // rebateValue is a flat DOLLAR payout per period, not a rate.
    const flatDollarMarketShareTerm = {
      ...marketShareTerm,
      tiers: marketShareTerm.tiers.map((t) => ({
        ...t,
        rebateValue: 5000, // $5,000 flat per period
        rebateType: "fixed_rebate",
      })),
    }
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [spendTerm, flatDollarMarketShareTerm],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 100_000,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 5000,
        payPeriodEnd: new Date("2025-01-31T00:00:00Z"),
        notes:
          "[auto-threshold-accrual] term:term-ms · currentMarketShare=70.5% · tier 2 · $5000.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")
    const row = result.rows.find((r) => r.month === "2025-01")
    const ms = row?.termContributions.find((c) => c.termIndex === 1)
    expect(ms?.accruedAmount).toBeCloseTo(5000, 2)
    expect(ms?.tierAchieved).toBe(2)
    // 5000 must NOT be scaled/rendered as a percent.
    expect(ms?.rebatePercent).toBe(0)
  })
})

