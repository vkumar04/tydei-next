import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Ladder-construction tests for `getContractDcfBundle`
 * (lib/actions/contract-dcf-links.ts).
 *
 * Two distinct regressions are pinned here.
 *
 * UNITS — the $1.2B bug. The ladder used to map every tier through
 * `scaleRebateValueForEngine`, which returns non-percent types UNCHANGED. A
 * `fixed_rebate` tier storing `$30,000` therefore landed in the engine's
 * PERCENT field, and `projectRebateAccrualSchedule` computed
 * `$4,000,000 × 30000 / 100 = $1,200,000,000` of year-1 rebate. The fix routes
 * through `toEngineRebateUnits`, which splits the pair: percent in
 * `rebateValue`, flat dollars in `fixedRebateAmount`.
 *
 * PLUMBING — the term's `spendBaseline` / `growthOnly` / `periodCap` +
 * `evaluationPeriod` were never selected or surfaced, so the DCF projection ran
 * an uncapped, non-growth ladder. They now ride on the ladder, with the cap
 * annualized by the canonical `annualizePeriodCap`.
 *
 * The math is NOT re-implemented here: where a dollar figure is asserted it is
 * produced by feeding the returned ladder through the real
 * `projectRebateAccrualSchedule`, exactly as the DCF surface does.
 */

const { contractFindFirstMock, requireVendorMock } = vi.hoisted(() => ({
  contractFindFirstMock: vi.fn(),
  requireVendorMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findFirst: contractFindFirstMock },
    dividendProposal: { findFirst: vi.fn() },
    contractDcfLink: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}))

vi.mock("@/lib/actions/auth", () => ({ requireVendor: requireVendorMock }))
vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { getContractDcfBundle } from "@/lib/actions/contract-dcf-links"
import { projectRebateAccrualSchedule } from "@/lib/contracts/rebate-accrual-schedule"
import type { ContractRebateLadder } from "@/lib/actions/contract-dcf-links"

// ─── Prisma row fixtures (only the selected columns) ─────────────

interface TierRow {
  tierNumber: number
  spendMin: number
  spendMax: number | null
  rebateValue: number
  rebateType: string
}

interface TermRow {
  termName: string | null
  termType: string
  rebateMethod: string | null
  boundaryRule: string | null
  evaluationPeriod: string
  /** Optional on purpose: Prisma `Decimal?` selects arrive as undefined when
   *  the column is absent from the row, which is what the `== null` guard in
   *  the action defends against. */
  spendBaseline?: number | null
  growthOnly?: boolean | null
  periodCap?: number | null
  tiers: TierRow[]
}

function term(overrides: Partial<TermRow> = {}): TermRow {
  return {
    termName: "Volume rebate",
    termType: "spend_rebate",
    rebateMethod: "cumulative",
    boundaryRule: "exclusive",
    evaluationPeriod: "annual",
    spendBaseline: null,
    growthOnly: false,
    periodCap: null,
    tiers: [],
    ...overrides,
  }
}

/**
 * Both Prisma reads in the action: the `assertContractVisible` probe, then the
 * full row. Contract spans 2025-01-01 → 2028-01-01 (3 years).
 */
function mockContract(
  terms: TermRow[],
  opts: { annualValue?: number; totalValue?: number } = {},
) {
  contractFindFirstMock.mockResolvedValueOnce({ id: "c-1" })
  contractFindFirstMock.mockResolvedValueOnce({
    totalValue: opts.totalValue ?? 0,
    annualValue: opts.annualValue ?? 4_000_000,
    effectiveDate: new Date("2025-01-01T00:00:00.000Z"),
    expirationDate: new Date("2028-01-01T00:00:00.000Z"),
    terms,
    dcfLinks: [],
  })
}

/** Narrowing helper — every ladder test needs a non-null ladder. */
function expectLadder(ladder: ContractRebateLadder | null): ContractRebateLadder {
  expect(ladder).not.toBeNull()
  if (ladder === null) throw new Error("expected a ladder")
  return ladder
}

/** Year-1 projected rebate for a ladder, via the real engine. */
function yearOneRebate(
  ladder: ContractRebateLadder,
  baseAnnualSpend: number,
): number {
  const schedule = projectRebateAccrualSchedule({
    tiers: ladder.tiers,
    periodProjections: [{ periodNumber: 1, projectedSpend: baseAnnualSpend }],
    method: ladder.rebateMethod,
    boundaryRule: ladder.boundaryRule,
    spendBaseline: ladder.spendBaseline,
    growthOnly: ladder.growthOnly,
    periodCap: ladder.annualSpendCap,
  })
  return schedule[0].projectedRebate
}

beforeEach(() => {
  vi.clearAllMocks()
  requireVendorMock.mockResolvedValue({
    vendor: { id: "vendor-1" },
    user: { id: "u-1" },
  })
})

// ─── Finding 1: rebate VALUE units ───────────────────────────────

describe("getContractDcfBundle ladder — rebate units", () => {
  it("maps a fixed_rebate tier to fixedRebateAmount dollars, not a percent", async () => {
    mockContract([
      {
        ...term(),
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 30_000, // stored DOLLARS for fixed_rebate
            rebateType: "fixed_rebate",
          },
        ],
      },
    ])

    const { ladder } = await getContractDcfBundle("c-1")
    const l = expectLadder(ladder)

    expect(l.tiers).toHaveLength(1)
    expect(l.tiers[0]).toEqual({
      spendMin: 0,
      spendMax: null,
      rebateValue: 0,
      fixedRebateAmount: 30_000,
    })
  })

  it("REGRESSION: a $30k fixed_rebate projects $30,000 in year 1, not $1.2B", async () => {
    mockContract(
      [
        {
          ...term(),
          tiers: [
            {
              tierNumber: 1,
              spendMin: 0,
              spendMax: null,
              rebateValue: 30_000,
              rebateType: "fixed_rebate",
            },
          ],
        },
      ],
      { annualValue: 4_000_000 },
    )

    const { ladder, baseAnnualSpend } = await getContractDcfBundle("c-1")
    const l = expectLadder(ladder)

    expect(baseAnnualSpend).toBe(4_000_000)
    // A flat $30,000 rebate pays $30,000 — it does not scale with spend.
    expect(yearOneRebate(l, baseAnnualSpend)).toBe(30_000)
    // The pre-fix value: $4,000,000 × 30000 / 100, from dollars read as percent.
    expect(yearOneRebate(l, baseAnnualSpend)).not.toBe(1_200_000_000)
  })

  it("scales a percent_of_spend fraction to engine percent", async () => {
    mockContract([
      {
        ...term(),
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 0.04, // stored FRACTION for percent_of_spend
            rebateType: "percent_of_spend",
          },
        ],
      },
    ])

    const { ladder, baseAnnualSpend } = await getContractDcfBundle("c-1")
    const l = expectLadder(ladder)

    expect(l.tiers[0]).toEqual({
      spendMin: 0,
      spendMax: null,
      rebateValue: 4,
      fixedRebateAmount: null,
    })
    // 4% of $4,000,000 — the cumulative method pays the rate on full spend.
    expect(yearOneRebate(l, baseAnnualSpend)).toBe(160_000)
  })

  it.each(["fixed_rebate_per_unit", "per_procedure_rebate"])(
    "yields a null ladder when every tier is %s (unit-driven, unpayable on spend)",
    async (rebateType) => {
      mockContract([
        {
          ...term(),
          tiers: [
            {
              tierNumber: 1,
              spendMin: 0,
              spendMax: 1_000_000,
              rebateValue: 25,
              rebateType,
            },
            {
              tierNumber: 2,
              spendMin: 1_000_000,
              spendMax: null,
              rebateValue: 40,
              rebateType,
            },
          ],
        },
      ])

      const { ladder } = await getContractDcfBundle("c-1")
      expect(ladder).toBeNull()
    },
  )

  it("skips the unpayable unit-driven term and takes the next payable one", async () => {
    mockContract([
      {
        ...term({ termName: "Per-procedure" }),
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 25,
            rebateType: "per_procedure_rebate",
          },
        ],
      },
      {
        ...term({ termName: "Spend tiers" }),
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 0.03,
            rebateType: "percent_of_spend",
          },
        ],
      },
    ])

    const { ladder } = await getContractDcfBundle("c-1")
    const l = expectLadder(ladder)

    expect(l.termName).toBe("Spend tiers")
    expect(l.tiers[0].rebateValue).toBe(3)
  })
})

// ─── Finding 2: term-level plumbing onto the ladder ──────────────

describe("getContractDcfBundle ladder — baseline / growth / cap plumbing", () => {
  const percentTier: TierRow = {
    tierNumber: 1,
    spendMin: 0,
    spendMax: null,
    rebateValue: 0.05,
    rebateType: "percent_of_spend",
  }

  it("annualizes a quarterly periodCap by ×4 and carries baseline + growthOnly", async () => {
    mockContract([
      {
        ...term({
          evaluationPeriod: "quarterly",
          spendBaseline: 1_000_000,
          growthOnly: true,
          periodCap: 250_000,
        }),
        tiers: [percentTier],
      },
    ])

    const { ladder } = await getContractDcfBundle("c-1")
    const l = expectLadder(ladder)

    expect(l.spendBaseline).toBe(1_000_000)
    expect(l.growthOnly).toBe(true)
    // $250,000 per quarter × 4 quarters = $1,000,000 of spend per year.
    expect(l.annualSpendCap).toBe(1_000_000)
  })

  it("passes an annual periodCap through ×1", async () => {
    mockContract([
      {
        ...term({
          evaluationPeriod: "annual",
          spendBaseline: null,
          growthOnly: false,
          periodCap: 500_000,
        }),
        tiers: [percentTier],
      },
    ])

    const { ladder } = await getContractDcfBundle("c-1")
    const l = expectLadder(ladder)

    expect(l.annualSpendCap).toBe(500_000)
    expect(l.spendBaseline).toBeNull()
    expect(l.growthOnly).toBe(false)
  })

  it("actually narrows the projection: cap then baseline reach the engine", async () => {
    mockContract(
      [
        {
          ...term({
            evaluationPeriod: "quarterly",
            spendBaseline: 1_000_000,
            growthOnly: true,
            periodCap: 250_000,
          }),
          tiers: [percentTier],
        },
      ],
      { annualValue: 4_000_000 },
    )

    const { ladder, baseAnnualSpend } = await getContractDcfBundle("c-1")
    const l = expectLadder(ladder)

    // $4,000,000 spend capped to $1,000,000, less the $1,000,000 growth
    // baseline → $0 qualifying spend → tier 1 (spendMin 0) at 5% of $0.
    expect(yearOneRebate(l, baseAnnualSpend)).toBe(0)
  })

  it("defaults baseline/growth/cap when the columns are ABSENT (undefined, not null)", async () => {
    const bare: TermRow = {
      termName: "No optional columns",
      termType: "spend_rebate",
      rebateMethod: "cumulative",
      boundaryRule: "exclusive",
      evaluationPeriod: "annual",
      tiers: [percentTier],
    }
    expect("spendBaseline" in bare).toBe(false)
    expect("periodCap" in bare).toBe(false)

    mockContract([bare], { annualValue: 4_000_000 })

    const { ladder, baseAnnualSpend } = await getContractDcfBundle("c-1")
    const l = expectLadder(ladder)

    // `=== null` here would give Number(undefined) === NaN.
    expect(l.spendBaseline).toBeNull()
    expect(Number.isNaN(Number(l.spendBaseline))).toBe(false)
    expect(l.growthOnly).toBe(false)
    expect(l.annualSpendCap).toBeNull()
    expect(Number.isNaN(Number(l.annualSpendCap))).toBe(false)

    // And nothing NaN leaks into the projection: 5% of the full $4,000,000.
    expect(yearOneRebate(l, baseAnnualSpend)).toBe(200_000)
  })
})
