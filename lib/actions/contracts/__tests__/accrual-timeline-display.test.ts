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

const {
  cogFindManyMock,
  contractFindUniqueMock,
  rebateFindManyMock,
  contractPricingFindManyMock,
} = vi.hoisted(() => ({
  cogFindManyMock: vi.fn(),
  contractFindUniqueMock: vi.fn(),
  rebateFindManyMock: vi.fn(),
  contractPricingFindManyMock: vi.fn(),
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
    contractPricing: {
      findMany: contractPricingFindManyMock,
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
  // bugs.rtfd 2026-06-12 R3: carve-out-only contracts mirror the writer's
  // pricing-file SKU basis on the early path — default to "no carved
  // lines" (writer basis empty → no spend series); R3 tests override.
  contractPricingFindManyMock.mockResolvedValue([])
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

    // bugs.rtfd 2026-06-12 R3 superseded the A1 display shape: carve-out
    // contracts now get real spend months mirroring the writer's
    // pricing-file SKU basis (see the R3 describe block below). THIS test
    // keeps no carved ContractPricing lines mocked (beforeEach default),
    // so the writer basis is empty → overlay-only row, exactly as A1
    // pinned. The tier/rate assertions (still 0 / "—") are unchanged —
    // placeholder ladders must never drive those columns.
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
    // ladder and no overlay rows → empty timeline. (R3 2026-06-12: still
    // empty here because there are no carved ContractPricing lines mocked
    // — the writer-basis spend series only exists when carve lines do.)
    expect(result.rows).toEqual([])
  })
})

describe("getAccrualTimeline — carve-out-only timeline gets real spend months + term cadence (bugs.rtfd 2026-06-12 R3)", () => {
  /** Prod evidence (Stryker Mako tie-in carve-out): the Performance tab
   * Accrual Timeline showed ONLY the 4 semi-annual ledger rows, every row
   * Spend $0 / Tier — / Rate —, "Latest cumulative spend: $0". The
   * 2026-06-11 A4 fix added real COG spend months to the
   * `termsWithTiers.length === 0` early path but only for the threshold
   * family — carve-out terms were deliberately left overlay-only. Wrong
   * call. R3 mirrors the carve-out WRITER's own spend basis
   * (`lib/contracts/recompute/carve-out.ts`): COG rows whose vendorItemNo
   * matches a ContractPricing line with carveOutPercent (normalizeSku on
   * BOTH sides — never raw ===), contract-pinned OR vendor-pinned
   * (group-aware vendor set), matchStatus on_contract/price_variance.
   * Tier / Rate stay 0 ("—"): placeholder ladders, per-SKU earning. */
  const carveOutTerm = {
    id: "term-co",
    termType: "carve_out",
    termName: "Mako Carve-Out",
    rebateMethod: "cumulative" as const,
    // Prod term shape: semi_annual — the recurring drop-from-cadence
    // regression class. MUST survive the early path's cadence mapping.
    evaluationPeriod: "semi_annual",
    appliesTo: "specific_items",
    categories: [] as string[],
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    // Importer placeholder ladder: spend-banded, rebateValue 0.
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
  }

  /** Carved pricing lines (the writer's basis). COG SKUs below drift in
   * case/whitespace — normalizeSku must still match them. */
  const carvedPricingLines = [
    { vendorItemNo: "MAKO-123" },
    { vendorItemNo: "KNEE-9" },
  ]

  /** COG rows across 6 distinct spend months (Jan–Jul 2025, May empty).
   * "OTHER-SKU" is on-contract but NOT carved — must be excluded from the
   * displayed Spend (writer-basis mirror, not vendor-wide spend). */
  const carvedCogRows = [
    { transactionDate: new Date("2025-01-15T00:00:00Z"), extendedPrice: 10_000, vendorItemNo: "mako-123" },
    { transactionDate: new Date("2025-02-15T00:00:00Z"), extendedPrice: 20_000, vendorItemNo: "MAKO-123 " },
    { transactionDate: new Date("2025-03-15T00:00:00Z"), extendedPrice: 30_000, vendorItemNo: "KNEE-9" },
    { transactionDate: new Date("2025-04-15T00:00:00Z"), extendedPrice: 40_000, vendorItemNo: "Mako-123" },
    { transactionDate: new Date("2025-05-20T00:00:00Z"), extendedPrice: 99_999, vendorItemNo: "OTHER-SKU" },
    { transactionDate: new Date("2025-06-15T00:00:00Z"), extendedPrice: 50_000, vendorItemNo: "knee-9" },
    { transactionDate: new Date("2025-07-15T00:00:00Z"), extendedPrice: 70_000, vendorItemNo: "MAKO-123" },
  ]

  /** Two persisted semi-annual writer rows — real note format:
   * `[auto-carve-out-accrual] term:<id> · N carve lines · $X`. No
   * `tier N` token → tier/rate stay 0. */
  const semiAnnualWriterRows = [
    {
      rebateEarned: 4389.87,
      payPeriodEnd: new Date("2025-06-30T23:59:59Z"),
      notes: "[auto-carve-out-accrual] term:term-co · 14487 carve lines · $4389.87",
    },
    {
      rebateEarned: 34000.13,
      payPeriodEnd: new Date("2025-12-31T23:59:59Z"),
      notes: "[auto-carve-out-accrual] term:term-co · 14487 carve lines · $34000.13",
    },
  ]

  const carveOutOnlyContract = {
    ...baseContract,
    contractType: "tie_in",
    // Full-year window so two semi-annual periods close inside it.
    expirationDate: new Date("2025-12-31T00:00:00Z"),
    terms: [carveOutTerm],
  }

  it("renders every contract month with real carved-SKU spend, lands both period accruals, resets cumulative at H1/H2, names the term", async () => {
    contractFindUniqueMock.mockResolvedValue(carveOutOnlyContract)
    contractPricingFindManyMock.mockResolvedValue(carvedPricingLines)
    cogFindManyMock.mockResolvedValue(carvedCogRows)
    rebateFindManyMock.mockResolvedValue(semiAnnualWriterRows)

    const result = await getAccrualTimeline("c-1")

    // Rows cover the contract window's months — not just the 2 ledger rows.
    expect(result.rows.map((r) => r.month)).toEqual([
      "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
      "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    ])
    // Spend = carved-SKU spend only (normalizeSku match; OTHER-SKU's
    // $99,999 in May is on-contract but not carved → excluded).
    expect(result.rows.map((r) => r.spend)).toEqual([
      10_000, 20_000, 30_000, 40_000, 0, 50_000, 70_000, 0, 0, 0, 0, 0,
    ])

    // Cumulative resets at the term's SEMI_ANNUAL cadence (recurring
    // regression class — semi_annual must survive the cadence mapping).
    expect(result.cumulativeReset).toBe("semi_annual")
    const jun = result.rows.find((r) => r.month === "2025-06")
    const jul = result.rows.find((r) => r.month === "2025-07")
    const dec = result.rows.find((r) => r.month === "2025-12")
    expect(jun?.cumulativeSpend).toBe(150_000) // H1 running total
    expect(jul?.cumulativeSpend).toBe(70_000) // H2 reset
    expect(dec?.cumulativeSpend).toBe(70_000)

    // The 2 writer accruals land on their period-end months.
    expect(jun?.accruedAmount).toBeCloseTo(4389.87, 2)
    expect(dec?.accruedAmount).toBeCloseTo(34000.13, 2)

    // Tier / Rate stay "—" (0): carve-outs earn per-SKU; the placeholder
    // ladder must never be resolved into tier/rate display.
    for (const r of result.rows) {
      expect(r.tierAchieved).toBe(0)
      expect(r.rebatePercent).toBe(0)
    }

    // Per-term breakout attributes the accrual to the carve-out term.
    const junContribution = jun?.termContributions.find(
      (c) => c.termIndex === 0,
    )
    expect(junContribution).toBeDefined()
    expect(junContribution?.accruedAmount).toBeCloseTo(4389.87, 2)
    expect(junContribution?.tierAchieved).toBe(0)

    // termLabels names the carve-out term with its cadence.
    expect(result.termLabels).toEqual([
      {
        termIndex: 0,
        termName: "Mako Carve-Out",
        evaluationPeriod: "semi_annual",
      },
    ])
  })

  it("mirrors the writer's COG scoping — carved pricing lines, contract-or-vendor-pinned rows, matched statuses only", async () => {
    contractFindUniqueMock.mockResolvedValue(carveOutOnlyContract)
    contractPricingFindManyMock.mockResolvedValue(carvedPricingLines)
    cogFindManyMock.mockResolvedValue(carvedCogRows)
    rebateFindManyMock.mockResolvedValue(semiAnnualWriterRows)

    await getAccrualTimeline("c-1")

    // Pricing fetch: only carve-out lines (carveOutPercent set).
    expect(contractPricingFindManyMock).toHaveBeenCalledTimes(1)
    const pricingWhere = contractPricingFindManyMock.mock.calls[0][0]?.where
    expect(pricingWhere).toEqual({
      contractId: "c-1",
      carveOutPercent: { not: null },
    })

    // COG fetch mirrors lib/contracts/recompute/carve-out.ts: contract-
    // pinned OR vendor-pinned-unmatched (group-aware vendor set — never
    // bare vendorId), matched statuses only.
    expect(cogFindManyMock).toHaveBeenCalledTimes(1)
    const cogWhere = cogFindManyMock.mock.calls[0][0]?.where
    expect(cogWhere?.facilityId).toBe("fac-1")
    expect(cogWhere?.OR).toEqual([
      { contractId: "c-1" },
      { contractId: null, vendorId: { in: ["v-1"] } },
    ])
    expect(cogWhere?.matchStatus).toEqual({
      in: ["on_contract", "price_variance"],
    })
  })

  it("skips the COG fetch entirely when the contract has no carved pricing lines (writer basis empty)", async () => {
    contractFindUniqueMock.mockResolvedValue(carveOutOnlyContract)
    contractPricingFindManyMock.mockResolvedValue([])
    cogFindManyMock.mockResolvedValue(carvedCogRows)
    rebateFindManyMock.mockResolvedValue(semiAnnualWriterRows)

    const result = await getAccrualTimeline("c-1")

    // No carved lines → the writer earns on nothing → no spend series;
    // overlay-only rows (pre-R3 / A1 shape) remain.
    expect(cogFindManyMock).not.toHaveBeenCalled()
    expect(result.rows.map((r) => r.month)).toEqual(["2025-06", "2025-12"])
    expect(result.rows.every((r) => r.spend === 0)).toBe(true)
  })

  it("respects the term's effective window when bucketing carved spend (effectiveEnd inclusive of its whole day, like the writer)", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...carveOutOnlyContract,
      terms: [
        {
          ...carveOutTerm,
          effectiveStart: new Date("2025-03-01T00:00:00Z"),
          // Midnight date — the writer clamps with endOfDay(), so a
          // transaction later on 06-30 still counts.
          effectiveEnd: new Date("2025-06-30T00:00:00Z"),
        },
      ],
    })
    contractPricingFindManyMock.mockResolvedValue(carvedPricingLines)
    cogFindManyMock.mockResolvedValue([
      ...carvedCogRows,
      // Lands ON the effectiveEnd date, after midnight — included.
      {
        transactionDate: new Date("2025-06-30T18:00:00Z"),
        extendedPrice: 5_000,
        vendorItemNo: "MAKO-123",
      },
    ])
    rebateFindManyMock.mockResolvedValue([semiAnnualWriterRows[0]])

    const result = await getAccrualTimeline("c-1")

    // Jan/Feb (before effectiveStart) and Jul (after effectiveEnd) carved
    // rows are out of the term's window — same clamp the writer applies.
    const spendByMonth = new Map(result.rows.map((r) => [r.month, r.spend]))
    expect(spendByMonth.get("2025-01") ?? 0).toBe(0)
    expect(spendByMonth.get("2025-02") ?? 0).toBe(0)
    expect(spendByMonth.get("2025-03")).toBe(30_000)
    expect(spendByMonth.get("2025-04")).toBe(40_000)
    expect(spendByMonth.get("2025-06")).toBe(55_000) // 50k + 5k on 06-30T18:00
    expect(spendByMonth.get("2025-07") ?? 0).toBe(0)
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

describe("getAccrualTimeline — market-share-only contracts (bugs.rtfd 2026-06-11 A4)", () => {
  /** Bug A4: a contract whose ONLY term is market_share showed a broken
   * Accrual Timeline — only the 2 months that happened to carry ledger
   * accrual rows, Spend $0 on every row, Tier "—", Rate "—", "Latest
   * cumulative spend: $0" — while the accrued dollars and hero
   * market-share (91.7%) were correct. Three prior fixes all repaired the
   * NORMAL tier-walk path; the `termsWithTiers.length === 0` early-return
   * path never ran the COG fetch and hardcoded spend 0 / tier 0 / rate 0 /
   * empty termLabels / "monthly" reset. */
  const marketShareOnlyTerm = {
    id: "term-ms",
    termType: "market_share",
    termName: "Qualified Annual Spend Rebate",
    rebateMethod: "cumulative" as const,
    evaluationPeriod: "annual",
    appliesTo: "specific_category",
    categories: ["Joint Replacement"],
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    // Market-share tiers: spendMin holds PERCENT thresholds (0-100);
    // rebateValue holds the payout as a FRACTION of in-scope spend.
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

  /** 6 months of in-scope COG spend (Jan–Jun 2025; contract runs
   * 2025-01-01 → 2025-06-30). */
  const sixMonthsSpend = [10_000, 20_000, 30_000, 40_000, 50_000, 60_000].map(
    (extendedPrice, i) => ({
      transactionDate: new Date(
        `2025-0${i + 1}-15T00:00:00Z`,
      ),
      extendedPrice,
      category: "Joint Replacement",
    }),
  )

  it("renders every COG month with real bucketed spend, tier 2 / 9% on accrual months, term label, and annual cadence", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [marketShareOnlyTerm],
    })
    cogFindManyMock.mockResolvedValue(sixMonthsSpend)
    // Two threshold-writer rows — pre-fix these were the ONLY two rows the
    // timeline rendered.
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 2700,
        payPeriodEnd: new Date("2025-03-31T00:00:00Z"),
        notes:
          "[auto-threshold-accrual] term:term-ms · currentMarketShare=70.5% (period) · tier 2 · spend=$30000.00 → $2700.00",
      },
      {
        rebateEarned: 8100,
        payPeriodEnd: new Date("2025-06-30T00:00:00Z"),
        notes:
          "[auto-threshold-accrual] term:term-ms · currentMarketShare=72.0% (period) · tier 2 · spend=$90000.00 → $8100.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")

    // Rows cover the COG months (Jan–Jun), not just the 2 accrual months.
    expect(result.rows.map((r) => r.month)).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
    ])
    // Per-row spend matches the bucketed COG.
    expect(result.rows.map((r) => r.spend)).toEqual([
      10_000, 20_000, 30_000, 40_000, 50_000, 60_000,
    ])
    // Cumulative resets at the term's ANNUAL cadence — all of 2025 runs up.
    expect(result.rows[5].cumulativeSpend).toBe(210_000)
    expect(result.cumulativeReset).toBe("annual")

    // Accrual months carry the achieved tier and its scaled rate
    // (tier 2 → rebateValue 0.09 fraction → 9 display percent, via
    // resolveOverlayTierRate semantics).
    const mar = result.rows.find((r) => r.month === "2025-03")
    expect(mar?.accruedAmount).toBeCloseTo(2700, 2)
    expect(mar?.tierAchieved).toBe(2)
    expect(mar?.rebatePercent).toBeCloseTo(9, 5)
    expect(mar?.achievedRebateType).toBe("percent_of_spend")
    expect(mar?.achievedRebateValue).toBeCloseTo(0.09, 8)
    const jun = result.rows.find((r) => r.month === "2025-06")
    expect(jun?.accruedAmount).toBeCloseTo(8100, 2)
    expect(jun?.tierAchieved).toBe(2)
    expect(jun?.rebatePercent).toBeCloseTo(9, 5)

    // The per-term breakout attributes the accrual to the market-share term.
    const marContribution = mar?.termContributions.find(
      (c) => c.termIndex === 0,
    )
    expect(marContribution).toBeDefined()
    expect(marContribution?.accruedAmount).toBeCloseTo(2700, 2)
    expect(marContribution?.tierAchieved).toBe(2)
    expect(marContribution?.rebatePercent).toBeCloseTo(9, 5)

    // termLabels names the market-share term with its cadence.
    expect(result.termLabels).toEqual([
      {
        termIndex: 0,
        termName: "Qualified Annual Spend Rebate",
        evaluationPeriod: "annual",
      },
    ])

    // Spend months with no accrual stay visible with $0 accrued and no tier.
    const jan = result.rows.find((r) => r.month === "2025-01")
    expect(jan?.accruedAmount).toBe(0)
    expect(jan?.tierAchieved).toBe(0)
  })

  it("scopes the COG fetch through the canonical helpers — group-aware vendor set + category IN filter", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [marketShareOnlyTerm],
    })
    cogFindManyMock.mockResolvedValue(sixMonthsSpend)
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 2700,
        payPeriodEnd: new Date("2025-03-31T00:00:00Z"),
        notes: "[auto-threshold-accrual] term:term-ms · tier 2 · $2700.00",
      },
    ])

    await getAccrualTimeline("c-1")

    // bugs.rtfd 2026-06-13 M: the timeline now ALSO computes the
    // per-window market share through the writer's canonical helper
    // (vendor numerator + facility denominator = 2 extra queries), so
    // target the spend-series union fetch by its category select — the
    // share queries select only transactionDate + extendedPrice.
    const unionCalls = cogFindManyMock.mock.calls.filter(
      (c) => c[0]?.select?.category === true,
    )
    expect(unionCalls).toHaveLength(1)
    const where = unionCalls[0][0]?.where
    // Group-aware vendor set (never bare vendorId — recurring drift class).
    expect(where?.vendorId).toEqual({ in: ["v-1"] })
    // Category scope flows through buildUnionCategoryWhereClause.
    expect(where?.category).toEqual({ in: ["Joint Replacement"] })
    expect(where?.facilityId).toBe("fac-1")
  })

  it("keeps accrual months that fall outside the COG spend window and preserves semi_annual cadence", async () => {
    // semi_annual is the recurring drop-from-cadence-allow-list regression
    // class — pin that the early path's cadence mapping carries it.
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      expirationDate: new Date("2025-12-31T00:00:00Z"),
      terms: [
        { ...marketShareOnlyTerm, evaluationPeriod: "semi_annual" },
      ],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-06-15T00:00:00Z"),
        extendedPrice: 50_000,
        category: "Joint Replacement",
      },
      {
        transactionDate: new Date("2025-07-15T00:00:00Z"),
        extendedPrice: 70_000,
        category: "Joint Replacement",
      },
    ])
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 4500,
        payPeriodEnd: new Date("2025-06-30T00:00:00Z"),
        notes: "[auto-threshold-accrual] term:term-ms · tier 2 · $4500.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")

    expect(result.cumulativeReset).toBe("semi_annual")
    // Cumulative resets at the H1/H2 boundary: June ends H1 at 50k, July
    // restarts H2 at 70k.
    const jun = result.rows.find((r) => r.month === "2025-06")
    const jul = result.rows.find((r) => r.month === "2025-07")
    expect(jun?.cumulativeSpend).toBe(50_000)
    expect(jul?.cumulativeSpend).toBe(70_000)
    expect(jun?.accruedAmount).toBeCloseTo(4500, 2)
  })
})

// bugs.rtfd 2026-06-13 M (Charles "Spend term with a market share term.
// Not showing the market share calculations. Should be showing a 7% rebate
// as well there. Also show the market share at the time of rebate in a
// column"): two visibility gaps —
//   (a) a window whose share sits below the lowest tier threshold pays $0,
//       the writer persists NO row (`periodPayment <= 0` gate), and the
//       term vanished from the timeline entirely;
//   (b) no per-period share was surfaced anywhere.
describe("getAccrualTimeline — market-share visibility + share column (bugs.rtfd 2026-06-13 M)", () => {
  const spendTerm = {
    id: "term-spend",
    termType: "spend_rebate",
    termName: "Annual Spend Rebate",
    appliesTo: "all_products",
    categories: [],
    cptCodes: [],
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
        rebateValue: 0.02,
        rebateType: "percent_of_spend",
      },
    ],
  }
  /** Market-share term, Bug #21 shape: spendMin = PERCENT threshold,
   * rebateValue = FRACTION of in-scope spend (0.07 → Charles's "7%"). */
  const msTerm = (thresholdPercent: number) => ({
    id: "term-ms",
    termType: "market_share",
    termName: "Market Share Rebate",
    appliesTo: "all_products",
    categories: [],
    cptCodes: [],
    rebateMethod: "cumulative" as const,
    evaluationPeriod: "annual",
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2025-01-02T00:00:00Z"),
    tiers: [
      {
        tierNumber: 1,
        tierName: null,
        spendMin: thresholdPercent,
        spendMax: null,
        rebateValue: 0.07,
        rebateType: "percent_of_spend",
      },
    ],
  })

  /** DB-faithful COG mock: honors the vendorId filter so the share
   * helper's vendor numerator (v-1 only) differs from its facility-wide
   * denominator. */
  const installCogRows = (
    rows: Array<{
      vendorId: string
      transactionDate: Date
      extendedPrice: number
      category: string | null
    }>,
  ) => {
    cogFindManyMock.mockImplementation(
      async (args: { where?: { vendorId?: { in: string[] } } }) => {
        const vendorFilter = args?.where?.vendorId
        return rows.filter(
          (r) => !vendorFilter || vendorFilter.in.includes(r.vendorId),
        )
      },
    )
  }

  type Row = {
    month: string
    accruedAmount: number
    marketSharePercent: number | null
    termContributions: Array<{
      termIndex: number
      accruedAmount: number
      tierAchieved: number
      rebatePercent: number
    }>
  }

  it("below-threshold share: term label + $0 window contribution + share column all render despite ZERO persisted rows", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [spendTerm, msTerm(70)],
    })
    // Vendor share = 30,000 / 100,000 = 30% — below the 70% threshold, so
    // the writer persisted nothing (the prod invisibility case).
    installCogRows([
      {
        vendorId: "v-1",
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 30_000,
        category: null,
      },
      {
        vendorId: "v-other",
        transactionDate: new Date("2025-01-20T00:00:00Z"),
        extendedPrice: 70_000,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([])

    const result = await getAccrualTimeline("c-1")

    // (a) The market-share term is named in termLabels even with no rows.
    expect(
      result.termLabels.map((l: { termName: string }) => l.termName),
    ).toEqual(["Annual Spend Rebate", "Market Share Rebate"])

    const rows = result.rows as unknown as Row[]
    // (b) Every month carries its window's share (30.0%).
    for (const m of ["2025-01", "2025-02", "2025-06"]) {
      expect(rows.find((r) => r.month === m)?.marketSharePercent).toBeCloseTo(
        30,
        5,
      )
    }
    // The window-end month (horizon-clamped: contract expires 2025-06-30)
    // carries a $0 contribution — tier 0 → rate 0 → the UI's "—".
    const jun = rows.find((r) => r.month === "2025-06")
    const ms = jun?.termContributions.find((c) => c.termIndex === 1)
    expect(ms).toEqual({
      termIndex: 1,
      accruedAmount: 0,
      tierAchieved: 0,
      rebatePercent: 0,
    })
    // Display only — no phantom dollars anywhere.
    const msTotal = rows.reduce(
      (s, r) =>
        s +
        r.termContributions
          .filter((c) => c.termIndex === 1)
          .reduce((s2, c) => s2 + c.accruedAmount, 0),
      0,
    )
    expect(msTotal).toBe(0)
  })

  it("above-threshold share with no persisted row yet: window contribution shows tier 1 · 7% (Charles's missing rate)", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [spendTerm, msTerm(70)],
    })
    // Vendor share = 80,000 / 100,000 = 80% — qualifies tier 1 (7%).
    installCogRows([
      {
        vendorId: "v-1",
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 80_000,
        category: null,
      },
      {
        vendorId: "v-other",
        transactionDate: new Date("2025-01-20T00:00:00Z"),
        extendedPrice: 20_000,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([])

    const result = await getAccrualTimeline("c-1")
    const rows = result.rows as unknown as Row[]
    expect(rows.find((r) => r.month === "2025-03")?.marketSharePercent).toBeCloseTo(
      80,
      5,
    )
    const jun = rows.find((r) => r.month === "2025-06")
    const ms = jun?.termContributions.find((c) => c.termIndex === 1)
    expect(ms).toMatchObject({
      termIndex: 1,
      accruedAmount: 0, // display-only — earned dollars stay writer-owned
      tierAchieved: 1,
    })
    // 0.07 fraction → 7% via resolveOverlayTierRate.
    expect(ms?.rebatePercent).toBeCloseTo(7, 5)
  })

  it("persisted writer rows stay authoritative — no duplicate window-end contribution", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [spendTerm, msTerm(70)],
    })
    installCogRows([
      {
        vendorId: "v-1",
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 80_000,
        category: null,
      },
      {
        vendorId: "v-other",
        transactionDate: new Date("2025-01-20T00:00:00Z"),
        extendedPrice: 20_000,
        category: null,
      },
    ])
    // Writer row landing in the SAME month the display pass targets
    // (the horizon-clamped window end, 2025-06).
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 5600,
        payPeriodEnd: new Date("2025-06-30T00:00:00Z"),
        notes:
          "[auto-threshold-accrual] term:term-ms · currentMarketShare=80.0% (period) · tier 1 · spend=$80000.00 → $5600.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")
    const rows = result.rows as unknown as Row[]
    const jun = rows.find((r) => r.month === "2025-06")
    const msContributions = jun?.termContributions.filter(
      (c) => c.termIndex === 1,
    )
    // Exactly ONE contribution — the ledger row, not a display duplicate.
    expect(msContributions).toHaveLength(1)
    expect(msContributions?.[0]).toMatchObject({
      termIndex: 1,
      accruedAmount: 5600,
      tierAchieved: 1,
    })
    expect(msContributions?.[0]?.rebatePercent).toBeCloseTo(7, 5)
  })

  it("contracts without a market_share term keep marketSharePercent null on every row", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [spendTerm],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 10_000,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([])

    const result = await getAccrualTimeline("c-1")
    const rows = result.rows as unknown as Row[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.marketSharePercent).toBeNull()
    }
  })
})

describe("getAccrualTimeline — multi-term spend not double-counted + per-period cumulative (bugs.rtfd 2026-06-13)", () => {
  it("two all-products annual terms: Spend column counts once and Cumulative resets per year", async () => {
    // Two annual all-products spend terms covering the SAME spend. Before
    // the fix the Spend column summed both terms (2x) and the Cumulative
    // ran lifetime — so a $3.7M year showed $7.4M and never matched the
    // per-period tier basis. Now: spend counted once, cumulative resets
    // annually.
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      effectiveDate: new Date("2024-01-01T00:00:00Z"),
      expirationDate: new Date("2025-12-31T00:00:00Z"),
      terms: [
        { id: "term-a", rebateMethod: "cumulative" as const, evaluationPeriod: "annual",
          appliesTo: "all_products", categories: [], effectiveStart: null, effectiveEnd: null,
          createdAt: new Date("2024-01-01T00:00:00Z"),
          tiers: [{ tierNumber: 1, tierName: null, spendMin: 0, spendMax: null, rebateValue: 0.03, rebateType: "percent_of_spend" }] },
        { id: "term-b", rebateMethod: "cumulative" as const, evaluationPeriod: "annual",
          appliesTo: "all_products", categories: [], effectiveStart: null, effectiveEnd: null,
          createdAt: new Date("2024-01-01T00:00:00Z"),
          tiers: [{ tierNumber: 1, tierName: null, spendMin: 0, spendMax: null, rebateValue: 0.02, rebateType: "percent_of_spend" }] },
      ],
    })
    cogFindManyMock.mockResolvedValue([
      { transactionDate: new Date("2024-06-15T00:00:00Z"), extendedPrice: 1_000_000 },
      { transactionDate: new Date("2025-06-15T00:00:00Z"), extendedPrice: 2_000_000 },
    ])

    const result = await getAccrualTimeline("c-1")
    const y2024 = result.rows.find((r) => r.month === "2024")
    const y2025 = result.rows.find((r) => r.month === "2025")
    // Spend counted ONCE (not 1M x 2 terms = 2M).
    expect(y2024?.spend).toBe(1_000_000)
    expect(y2025?.spend).toBe(2_000_000)
    // Cumulative resets per year (NOT lifetime 1M -> 3M).
    expect(y2024?.cumulativeSpend).toBe(1_000_000)
    expect(y2025?.cumulativeSpend).toBe(2_000_000)
    // Accrual still sums BOTH terms: 2024 = 1M x (3% + 2%) = 50,000.
    expect(y2024?.accruedAmount).toBeCloseTo(50_000, 2)
  })
})
