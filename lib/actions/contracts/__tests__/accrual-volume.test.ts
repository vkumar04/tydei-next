/**
 * Bug 3 (2026-05-17): volume_rebate contracts need a "Volume (units)"
 * column on the Accrual Timeline so users can see the qty that drove
 * tier achievement. The data layer surfaces per-row `volume` plus a
 * contract-level `isVolumeRebate` flag.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

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
})
