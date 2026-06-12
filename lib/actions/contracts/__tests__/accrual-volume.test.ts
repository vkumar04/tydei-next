/**
 * Bug 3 (2026-05-17): volume_rebate contracts need a "Volume (units)"
 * column on the Accrual Timeline so users can see the qty that drove
 * tier achievement. The data layer surfaces per-row `volume` plus a
 * contract-level `isVolumeRebate` flag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const {
  cogFindManyMock,
  contractFindUniqueMock,
  caseFindManyMock,
  rebateFindManyMock,
} = vi.hoisted(() => ({
  cogFindManyMock: vi.fn(),
  contractFindUniqueMock: vi.fn(),
  caseFindManyMock: vi.fn(),
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
    case: {
      findMany: caseFindManyMock,
    },
    // 2026-06-10: volume terms now overlay persisted [auto-volume-accrual]
    // rows — the timeline fetches them via rebate.findMany.
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
import {
  computeVolumeTierRebate,
  normalizeVolumeTiers,
} from "@/lib/contracts/recompute/volume"

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
  caseFindManyMock.mockResolvedValue([])
  rebateFindManyMock.mockResolvedValue([])
})

describe("getAccrualTimeline — volume_rebate column data (Bug 3)", () => {
  it("returns isVolumeRebate=true and per-row volume from COG quantity fallback", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          termType: "volume_rebate",
          termName: "Volume Tier",
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
              volumeMin: 0,
              volumeMax: null,
              rebateValue: 10,
              rebateType: "fixed_rebate",
            },
          ],
        },
      ],
    })

    // Two months of COG with explicit quantities.
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 100,
        quantity: 30,
        category: null,
      },
      {
        transactionDate: new Date("2025-02-10T00:00:00Z"),
        extendedPrice: 200,
        quantity: 50,
        category: null,
      },
    ])

    const result = await getAccrualTimeline("c-1")

    expect(
      (result as unknown as { isVolumeRebate: boolean }).isVolumeRebate,
    ).toBe(true)

    type Row = { month: string; volume?: number }
    const rows = result.rows as unknown as Row[]
    const jan = rows.find((r) => r.month === "2025-01")
    const feb = rows.find((r) => r.month === "2025-02")
    expect(jan?.volume).toBe(30)
    expect(feb?.volume).toBe(50)
  })

  it("isVolumeRebate=false for spend-only contracts", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          termType: "spend_rebate",
          termName: "Annual",
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
        },
      ],
    })
    cogFindManyMock.mockResolvedValue([])
    const result = await getAccrualTimeline("c-1")
    expect(
      (result as unknown as { isVolumeRebate: boolean }).isVolumeRebate,
    ).toBe(false)
  })

  // Charles 2026-06-10 "Volume rebates not showing any accrued rebates":
  // the volume writer persists [auto-volume-accrual] rows but the timeline
  // never overlaid them, while the tier walk forces per-unit tiers to $0 —
  // so Accrued stayed $0 with a real rate showing. The overlay must surface
  // the persisted rows AND attribute them to the volume term's label.
  it("overlays persisted [auto-volume-accrual] rows with term attribution", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
          id: "term-1",
          termType: "volume_rebate",
          termName: "Volume Tier",
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
              volumeMin: 0,
              volumeMax: null,
              rebateValue: 5,
              rebateType: "fixed_rebate_per_unit",
            },
          ],
        },
      ],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 100,
        quantity: 30,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 150,
        payPeriodEnd: new Date("2025-01-31T23:59:59Z"),
        notes: "[auto-volume-accrual] term:term-1 · 30 occurrences · $150.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")
    type Row = {
      month: string
      accruedAmount: number
      termContributions: Array<{ termIndex: number; accruedAmount: number }>
    }
    const rows = result.rows as unknown as Row[]
    const jan = rows.find((r) => r.month === "2025-01")
    expect(jan?.accruedAmount).toBe(150)
    // Attributed to the volume term (walk index 0 — it has tiers).
    expect(jan?.termContributions).toEqual([
      expect.objectContaining({ termIndex: 0, accruedAmount: 150 }),
    ])
    const total = rows.reduce((s2, r) => s2 + r.accruedAmount, 0)
    expect(total).toBe(150)
  })

  // Charles 2026-06-10 "there are two terms one is market share the other is
  // spend rebate the timeline should reflect that": the market-share term is
  // excluded from the tier walk, so its persisted [auto-threshold-accrual]
  // rows must surface as a SEPARATE labeled contribution — not silently fold
  // into an unlabeled total.
  it("multi-term: market_share overlay rows get their own term label + contribution", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      terms: [
        {
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
        },
        {
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
              spendMin: 70, // percent threshold, NOT dollars
              spendMax: null,
              rebateValue: 25_000,
              rebateType: "fixed_rebate",
            },
          ],
        },
      ],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 1_000,
        quantity: 1,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 25_000,
        payPeriodEnd: new Date("2025-01-31T23:59:59Z"),
        notes:
          "[auto-threshold-accrual] term:term-ms · currentMarketShare=92.1% (period) · tier 1 · $25000.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")
    type Label = { termIndex: number; termName: string }
    const labels = result.termLabels as unknown as Label[]
    // Walk term (spend) is index 0; the market-share overlay term gets its
    // own appended label.
    expect(labels.map((l) => l.termName)).toEqual([
      "Annual Spend Rebate",
      "Market Share Rebate",
    ])

    type Row = {
      month: string
      accruedAmount: number
      termContributions: Array<{
        termIndex: number
        accruedAmount: number
        tierAchieved: number
      }>
    }
    const rows = result.rows as unknown as Row[]
    const jan = rows.find((r) => r.month === "2025-01")
    // Spend walk: 2% × $1,000 = $20; market-share overlay: $25,000.
    expect(jan?.accruedAmount).toBeCloseTo(25_020)
    const msContribution = jan?.termContributions.find(
      (c) => c.termIndex === 1,
    )
    expect(msContribution).toMatchObject({
      accruedAmount: 25_000,
      tierAchieved: 1,
    })
  })

  // bug-bash 2026-06-11 follow-up F1, same drift class as the 2026-06-09
  // audit fixes in the same file: the per-month "Volume (units)" COG
  // fallback query scoped `vendorId: contract.vendorId` (bare), so grouped
  // contracts (additionalVendorIds) under-counted displayed units vs the
  // group-aware writer.
  it("F1: scopes the volume-series COG query through the group-aware vendor set", async () => {
    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      additionalVendorIds: ["v-2"],
      terms: [
        {
          id: "term-1",
          termType: "volume_rebate",
          termName: "Volume Tier",
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
              volumeMin: 0,
              volumeMax: null,
              rebateValue: 5,
              rebateType: "fixed_rebate_per_unit",
            },
          ],
        },
      ],
    })
    cogFindManyMock.mockResolvedValue([])

    await getAccrualTimeline("c-1")

    // The volume-series query is the one that selects `quantity` (the
    // main spend fetch intentionally omits it).
    const volumeCall = cogFindManyMock.mock.calls.find(
      (c) => c[0]?.select?.quantity === true,
    )
    expect(volumeCall).toBeDefined()
    // Group-aware vendor set including additionalVendorIds — never the
    // bare contract.vendorId (recurring drift class).
    expect(volumeCall?.[0]?.where?.vendorId).toEqual({
      in: ["v-1", "v-2"],
    })
  })
})

// bug-bash 2026-06-11 follow-up F2 (Charles screenshot, bug A5 residual):
// an annual volume term showed per-month units and "$11.00 / unit" but
// Accrued $0 for every month until the first evaluation window CLOSED —
// the writer only persists [auto-volume-accrual] rows for closed windows
// (W1.W-B1) and the walk zeroes volume accrual in favor of the overlay,
// while spend terms show LIVE walk accrual on the same timeline. The
// timeline now renders a DISPLAY-ONLY in-progress accrual for months in
// the current unclosed window, via the writer's own exported tier math.
describe("getAccrualTimeline — in-progress volume accrual (bug-bash 2026-06-11 F2)", () => {
  // Tier ladder per the F2 spec: 0-4999 → $5/unit, 5000-9999 → $9/unit,
  // 10000+ → $11/unit (fixed_rebate_per_unit, cumulative method).
  const volumeTiers = [
    {
      tierNumber: 1,
      tierName: null,
      spendMin: 0,
      spendMax: 5000,
      volumeMin: 0,
      volumeMax: 5000,
      rebateValue: 5,
      rebateType: "fixed_rebate_per_unit",
    },
    {
      tierNumber: 2,
      tierName: null,
      spendMin: 5000,
      spendMax: 10000,
      volumeMin: 5000,
      volumeMax: 10000,
      rebateValue: 9,
      rebateType: "fixed_rebate_per_unit",
    },
    {
      tierNumber: 3,
      tierName: null,
      spendMin: 10000,
      spendMax: null,
      volumeMin: 10000,
      volumeMax: null,
      rebateValue: 11,
      rebateType: "fixed_rebate_per_unit",
    },
  ]

  const annualVolumeTerm = {
    id: "term-1",
    termType: "volume_rebate",
    termName: "Annual Volume Tier",
    appliesTo: "all_products",
    categories: [],
    cptCodes: [],
    rebateMethod: "cumulative" as const,
    evaluationPeriod: "annual",
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    tiers: volumeTiers,
  }

  type Row = {
    month: string
    accruedAmount: number
    isPeriodSubtotal?: boolean
    termContributions: Array<{
      termIndex: number
      accruedAmount: number
      tierAchieved: number
      rebatePercent: number
    }>
  }
  const monthlyRows = (result: { rows: unknown }): Row[] =>
    (result.rows as Row[]).filter((r) => !r.isPeriodSubtotal)

  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows live in-progress accrual for the open window (802 units × $5 = $4,010, tier 1)", async () => {
    // Today is INSIDE year-1 of the annual window — the writer has
    // persisted nothing yet (window unclosed).
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2025-04-15T12:00:00Z"))

    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      expirationDate: new Date("2025-12-31T00:00:00Z"),
      terms: [annualVolumeTerm],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 802,
        quantity: 802,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([]) // no closed window yet

    const result = await getAccrualTimeline("c-1")
    const rows = monthlyRows(result)

    const jan = rows.find((r) => r.month === "2025-01")
    expect(jan?.accruedAmount).toBeCloseTo(4010, 6)
    expect(jan?.termContributions).toEqual([
      expect.objectContaining({
        termIndex: 0,
        accruedAmount: 4010,
        tierAchieved: 1,
        // Rate path unchanged: per-unit dollar tiers never render as a
        // percent (A2 rule) — rebatePercent stays 0.
        rebatePercent: 0,
      }),
    ])
    // Months with no additional units accrue no additional display value.
    for (const m of ["2025-02", "2025-03", "2025-04"]) {
      expect(rows.find((r) => r.month === m)?.accruedAmount).toBe(0)
    }
    const total = rows.reduce((s, r) => s + r.accruedAmount, 0)
    expect(total).toBeCloseTo(4010, 6)
  })

  it("crossing a tier boundary mid-window attributes the writer-consistent delta (totalAt(5100) − totalAt(4900))", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2025-04-15T12:00:00Z"))

    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      expirationDate: new Date("2025-12-31T00:00:00Z"),
      terms: [annualVolumeTerm],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2025-01-15T00:00:00Z"),
        extendedPrice: 1000,
        quantity: 4900,
        category: null,
      },
      {
        transactionDate: new Date("2025-02-10T00:00:00Z"),
        extendedPrice: 100,
        quantity: 200,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([])

    const result = await getAccrualTimeline("c-1")
    const rows = monthlyRows(result)

    // Writer-consistent window-to-date values via the SAME exported
    // helper the writer persists with — drift impossible by construction.
    const sorted = normalizeVolumeTiers(volumeTiers)
    const totalAt4900 = computeVolumeTierRebate(sorted, 4900, 1000)
    const totalAt5100 = computeVolumeTierRebate(sorted, 5100, 1100)
    expect(totalAt4900.rebateEarned).toBeCloseTo(24_500, 6) // 4900 × $5
    expect(totalAt5100.rebateEarned).toBeCloseTo(45_900, 6) // 5100 × $9 (cumulative re-rate)

    const jan = rows.find((r) => r.month === "2025-01")
    const feb = rows.find((r) => r.month === "2025-02")
    expect(jan?.accruedAmount).toBeCloseTo(totalAt4900.rebateEarned, 6)
    expect(jan?.termContributions[0]).toMatchObject({ tierAchieved: 1 })
    // Delta attribution: month 2 = totalAt(5100) − totalAt(4900).
    expect(feb?.accruedAmount).toBeCloseTo(
      totalAt5100.rebateEarned - totalAt4900.rebateEarned,
      6,
    )
    expect(feb?.termContributions[0]).toMatchObject({ tierAchieved: 2 })
    // Window-to-date sum ≡ what the writer will persist at window close.
    const total = rows.reduce((s, r) => s + r.accruedAmount, 0)
    expect(total).toBeCloseTo(totalAt5100.rebateEarned, 6)
  })

  it("closed window keeps the persisted overlay value with NO added in-progress accrual (no double count)", async () => {
    // Today is in year 2: year-1 window CLOSED (overlay row persisted),
    // year-2 window open with fresh units.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"))

    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      terms: [annualVolumeTerm],
    })
    cogFindManyMock.mockResolvedValue([
      // Year-1 units — already settled by the writer's overlay row below.
      {
        transactionDate: new Date("2025-05-15T00:00:00Z"),
        extendedPrice: 2000,
        quantity: 9000,
        category: null,
      },
      // Year-2 (open window) units — in-progress display only.
      {
        transactionDate: new Date("2026-01-20T00:00:00Z"),
        extendedPrice: 100,
        quantity: 300,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 81_000, // 9000 × $9 (tier 2), persisted at window close
        payPeriodEnd: new Date("2025-12-31T23:59:59Z"),
        notes: "[auto-volume-accrual] term:term-1 · 9000 units · $81000.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")
    const rows = monthlyRows(result)

    // Closed-window months: overlay value lands on the period-end month;
    // every other year-1 month stays $0 (no in-progress in a closed
    // window — the units month 2025-05 gets nothing extra).
    expect(rows.find((r) => r.month === "2025-12")?.accruedAmount).toBe(81_000)
    expect(rows.find((r) => r.month === "2025-05")?.accruedAmount).toBe(0)
    // Open-window month: 300 units × $5 = $1,500 in-progress display.
    expect(
      rows.find((r) => r.month === "2026-01")?.accruedAmount,
    ).toBeCloseTo(1500, 6)
    // Total = persisted + in-progress exactly once.
    const total = rows.reduce((s, r) => s + r.accruedAmount, 0)
    expect(total).toBeCloseTo(82_500, 6)
  })
})

// bugs.rtfd 2026-06-13 V (prod cmqbcw4wd00040ypgudy9modb): the displayed
// Tier / Rate for volume terms came from the DOLLAR tier walk — cumulative
// SPEND compared against UNIT thresholds stored in spendMin/spendMax. A
// 2026 window with 3,873 cumulative units (correctly accruing $5/unit via
// the F2 path) displayed "Tier 2 · $7.00 / unit" because $2.4M spend ≥
// "5001". Display must derive from window-cumulative UNITS via the
// writer's own `selectAchievedVolumeTier`.
describe("getAccrualTimeline — volume Tier/Rate display derives from UNITS (bugs.rtfd 2026-06-13 V)", () => {
  // The prod ladder shape: unit thresholds stored ONLY in spendMin /
  // spendMax (legacy rows — no volumeMin/volumeMax), $/unit payouts.
  const unitTiers = [
    {
      tierNumber: 1,
      tierName: null,
      spendMin: 0,
      spendMax: 5000,
      rebateValue: 5,
      rebateType: "fixed_rebate_per_unit",
    },
    {
      tierNumber: 2,
      tierName: null,
      spendMin: 5001,
      spendMax: null,
      rebateValue: 7,
      rebateType: "fixed_rebate_per_unit",
    },
  ]
  const annualUnitTerm = {
    id: "term-1",
    termType: "volume_rebate",
    termName: "Annual Volume Rebate",
    appliesTo: "all_products",
    categories: [],
    cptCodes: [],
    rebateMethod: "cumulative" as const,
    evaluationPeriod: "annual",
    effectiveStart: null,
    effectiveEnd: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    tiers: unitTiers,
  }

  type Row = {
    month: string
    accruedAmount: number
    tierAchieved: number
    achievedRebateType: string | null
    achievedRebateValue: number
    isPeriodSubtotal?: boolean
    termContributions: Array<{
      termIndex: number
      accruedAmount: number
      tierAchieved: number
      rebatePercent: number
    }>
  }
  const allRows = (result: { rows: unknown }): Row[] => result.rows as Row[]
  const monthlyRows = (result: { rows: unknown }): Row[] =>
    allRows(result).filter((r) => !r.isPeriodSubtotal)

  afterEach(() => {
    vi.useRealTimers()
  })

  it("open window at 3,873 cumulative units displays tier 1 / $5 per unit — NOT the dollar walk's tier 2 / $7", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"))

    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      effectiveDate: new Date("2026-01-01T00:00:00Z"),
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      terms: [annualUnitTerm],
    })
    // Dollar spend is HUGE relative to the unit thresholds — the dollar
    // walk reads $2.4M ≥ "5001" → tier 2, the prod bug.
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2026-01-15T00:00:00Z"),
        extendedPrice: 800_000,
        quantity: 1000,
        category: null,
      },
      {
        transactionDate: new Date("2026-02-15T00:00:00Z"),
        extendedPrice: 800_000,
        quantity: 1000,
        category: null,
      },
      {
        transactionDate: new Date("2026-03-15T00:00:00Z"),
        extendedPrice: 800_000,
        quantity: 1873,
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([]) // open window — nothing persisted

    const result = await getAccrualTimeline("c-1")
    const rows = monthlyRows(result)

    for (const m of ["2026-01", "2026-02", "2026-03", "2026-04"]) {
      const row = rows.find((r) => r.month === m)
      expect(row?.tierAchieved).toBe(1)
      expect(row?.achievedRebateType).toBe("fixed_rebate_per_unit")
      expect(row?.achievedRebateValue).toBe(5) // NOT 7
    }
    // Accrual stays the F2 $5/unit deltas (units × $5 at tier 1).
    expect(rows.find((r) => r.month === "2026-01")?.accruedAmount).toBeCloseTo(
      5000,
      6,
    )
    expect(rows.find((r) => r.month === "2026-02")?.accruedAmount).toBeCloseTo(
      5000,
      6,
    )
    expect(rows.find((r) => r.month === "2026-03")?.accruedAmount).toBeCloseTo(
      9365,
      6,
    )
    const total = rows.reduce((s, r) => s + r.accruedAmount, 0)
    expect(total).toBeCloseTo(19_365, 6) // 3,873 × $5
  })

  it("closed 2024 window (7,755 units · persisted $54,285) displays tier 2 / $7 per unit on its months + subtotal", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"))

    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      effectiveDate: new Date("2024-01-01T00:00:00Z"),
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      terms: [annualUnitTerm],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2024-01-15T00:00:00Z"),
        extendedPrice: 900_000,
        quantity: 3000,
        category: null,
      },
      {
        transactionDate: new Date("2024-03-15T00:00:00Z"),
        extendedPrice: 1_500_000,
        quantity: 4755,
        category: null,
      },
    ])
    // The writer's closed-window row: 7,755 × $7 = $54,285. Volume notes
    // carry no `tier N` — the display tier must come from the units.
    rebateFindManyMock.mockResolvedValue([
      {
        rebateEarned: 54_285,
        payPeriodEnd: new Date("2024-12-31T23:59:59Z"),
        notes: "[auto-volume-accrual] term:term-1 · 7755 units · $54285.00",
      },
    ])

    const result = await getAccrualTimeline("c-1")
    const rows = monthlyRows(result)

    // Before the crossing: window-cumulative 3,000 units → tier 1 / $5.
    const jan = rows.find((r) => r.month === "2024-01")
    expect(jan?.tierAchieved).toBe(1)
    expect(jan?.achievedRebateValue).toBe(5)
    // March crosses 5,001 (7,755 window units) → tier 2 / $7 from there.
    const mar = rows.find((r) => r.month === "2024-03")
    expect(mar?.tierAchieved).toBe(2)
    expect(mar?.achievedRebateValue).toBe(7)
    // The window-close month carries the persisted accrual AND the
    // unit-derived tier 2 / $7 — matching the $54,285 = 7,755 × $7 math.
    const dec = rows.find((r) => r.month === "2024-12")
    expect(dec?.accruedAmount).toBe(54_285)
    expect(dec?.tierAchieved).toBe(2)
    expect(dec?.achievedRebateType).toBe("fixed_rebate_per_unit")
    expect(dec?.achievedRebateValue).toBe(7)
    // Overlay contribution picks up the units-derived tier (notes have none).
    expect(dec?.termContributions).toEqual([
      expect.objectContaining({ termIndex: 0, accruedAmount: 54_285, tierAchieved: 2 }),
    ])
    // The 2024 period subtotal settles at tier 2 / $7 too.
    const subtotal = allRows(result).find(
      (r) => r.isPeriodSubtotal && r.month === "2024",
    )
    expect(subtotal?.tierAchieved).toBe(2)
    expect(subtotal?.achievedRebateValue).toBe(7)
    expect(subtotal?.accruedAmount).toBe(54_285)
    // Nothing double-counts: lifetime total = the persisted row only.
    const total = rows.reduce((s, r) => s + r.accruedAmount, 0)
    expect(total).toBeCloseTo(54_285, 6)
  })

  it("mid-window unit crossing flips the displayed tier to 2 / $7 from that month on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"))

    contractFindUniqueMock.mockResolvedValue({
      ...baseContract,
      effectiveDate: new Date("2026-01-01T00:00:00Z"),
      expirationDate: new Date("2026-12-31T00:00:00Z"),
      terms: [annualUnitTerm],
    })
    cogFindManyMock.mockResolvedValue([
      {
        transactionDate: new Date("2026-01-15T00:00:00Z"),
        extendedPrice: 800_000,
        quantity: 3000,
        category: null,
      },
      {
        transactionDate: new Date("2026-02-15T00:00:00Z"),
        extendedPrice: 800_000,
        quantity: 2500, // window-cumulative 5,500 — crosses 5,001
        category: null,
      },
    ])
    rebateFindManyMock.mockResolvedValue([])

    const result = await getAccrualTimeline("c-1")
    const rows = monthlyRows(result)

    const jan = rows.find((r) => r.month === "2026-01")
    expect(jan?.tierAchieved).toBe(1)
    expect(jan?.achievedRebateValue).toBe(5)
    expect(jan?.accruedAmount).toBeCloseTo(15_000, 6) // 3,000 × $5
    const feb = rows.find((r) => r.month === "2026-02")
    expect(feb?.tierAchieved).toBe(2)
    expect(feb?.achievedRebateValue).toBe(7)
    // Cumulative re-rate delta: 5,500 × $7 − 3,000 × $5 = $23,500.
    expect(feb?.accruedAmount).toBeCloseTo(23_500, 6)
    // After the crossing (no new units) the displayed tier STAYS 2 / $7.
    const mar = rows.find((r) => r.month === "2026-03")
    expect(mar?.tierAchieved).toBe(2)
    expect(mar?.achievedRebateValue).toBe(7)
    expect(mar?.accruedAmount).toBe(0)
  })
})
