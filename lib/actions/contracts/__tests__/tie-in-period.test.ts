/**
 * Integration tests for `getTieInCapitalForContractPeriod`.
 *
 * Mocks Prisma + auth at the module boundary. The wrapper builds a
 * `TieInCapitalConfig` per capital line item + the contract's first
 * SPEND_REBATE-shaped term, runs the per-period evaluator per line,
 * and aggregates the per-line results.
 *
 * Engine math correctness is covered by per-engine unit tests; these
 * assertions lock down (a) that the wrapper assembles the right
 * config(s), (b) that the multi-line aggregation totals are correct,
 * and (c) the no-line / wrong-type guards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type FakeTier = {
  id: string
  tierNumber: number
  tierName: string | null
  spendMin: number
  spendMax: number | null
  rebateValue: number
  rebateType: string
  fixedRebateAmount: number | null
  reducedPrice: number | null
  priceReductionPercent: number | null
}

type FakeTerm = {
  id: string
  termType: string
  rebateMethod: string | null
  boundaryRule: string | null
  appliesTo: string | null
  categories: string[] | null
  referenceNumbers: string[] | null
  baselineType: string | null
  negotiatedBaseline: number | null
  growthOnly: boolean | null
  cptCodes: string[] | null
  fixedRebatePerOccurrence: number | null
  marketShareVendorId: string | null
  marketShareCategory: string | null
  periodCap: number | null
  groupedReferenceNumbers: string[] | null
  priceReductionTrigger: string | null
  createdAt: Date
  tiers: FakeTier[]
}

type FakeCapitalLineItem = {
  id: string
  description: string
  itemNumber: string | null
  serialNumber: string | null
  contractTotal: number
  initialSales: number | null
  interestRate: number | null
  termMonths: number | null
  paymentType: string
  paymentCadence: string
  createdAt: Date
}

type FakeContract = {
  id: string
  name: string
  vendorId: string
  contractType: string
  effectiveDate: Date
  expirationDate: Date
  terms: FakeTerm[]
  capitalLineItems: FakeCapitalLineItem[]
} | null

let contractFixture: FakeContract = null
let cogFixture: Array<{
  inventoryNumber: string
  category: string | null
  quantity: number
  unitCost: number
  extendedPrice: number
  transactionDate: Date
}> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUnique: vi.fn(async () => contractFixture),
    },
    cOGRecord: {
      findMany: vi.fn(async () => cogFixture),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
}))

import { getTieInCapitalForContractPeriod } from "@/lib/actions/contracts/tie-in-period"

function makeTier(overrides: Partial<FakeTier>): FakeTier {
  return {
    id: "tier-x",
    tierNumber: 1,
    tierName: null,
    spendMin: 0,
    spendMax: null,
    rebateValue: 0,
    rebateType: "percent_of_spend",
    fixedRebateAmount: null,
    reducedPrice: null,
    priceReductionPercent: null,
    ...overrides,
  }
}

function makeSpendTerm(tiers: FakeTier[]): FakeTerm {
  return {
    id: "term-1",
    termType: "spend_rebate",
    rebateMethod: "cumulative",
    boundaryRule: "exclusive",
    appliesTo: null,
    categories: null,
    referenceNumbers: null,
    baselineType: null,
    negotiatedBaseline: null,
    growthOnly: false,
    cptCodes: null,
    fixedRebatePerOccurrence: null,
    marketShareVendorId: null,
    marketShareCategory: null,
    periodCap: null,
    groupedReferenceNumbers: null,
    priceReductionTrigger: null,
    createdAt: new Date("2026-01-01"),
    tiers,
  }
}

function makeCapitalItem(
  overrides: Partial<FakeCapitalLineItem>,
): FakeCapitalLineItem {
  return {
    id: "cli-1",
    description: "Imaging system",
    itemNumber: null,
    serialNumber: null,
    contractTotal: 120_000,
    initialSales: 0,
    interestRate: 0,
    termMonths: 12,
    paymentType: "fixed",
    paymentCadence: "monthly",
    createdAt: new Date("2026-01-01"),
    ...overrides,
  }
}

describe("getTieInCapitalForContractPeriod", () => {
  beforeEach(() => {
    contractFixture = null
    cogFixture = []
  })

  it("single-line capital + sufficient rebate → shortfall = 0, schedule entry returned", async () => {
    contractFixture = {
      id: "c-1",
      name: "Tie-in c-1",
      vendorId: "v-1",
      contractType: "tie_in",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeSpendTerm([
          makeTier({
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 0.5, // 50% — guarantees rebate covers monthly amort
          }),
        ]),
      ],
      capitalLineItems: [
        makeCapitalItem({
          contractTotal: 120_000,
          interestRate: 0, // monthly amort = 10k
          termMonths: 12,
        }),
      ],
    }
    // Massive spend → 50% rebate covers the 10k monthly amort easily.
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: null,
        quantity: 1,
        unitCost: 1_000_000,
        extendedPrice: 1_000_000,
        transactionDate: new Date("2026-02-01"),
      },
    ]
    const r = await getTieInCapitalForContractPeriod({
      contractId: "c-1",
      periodNumber: 1,
    })
    expect(r.result).not.toBeNull()
    expect(r.result?.type).toBe("TIE_IN_CAPITAL")
    expect(r.result?.amortizationEntry).not.toBeNull()
    expect(r.result?.amortizationEntry?.amortizationDue).toBeCloseTo(10_000, 2)
    // rebate >> scheduled → trueUpAdjustment <= 0 (over-accrued / surplus).
    expect(r.result?.trueUpAdjustment).toBeLessThanOrEqual(0)
    // No CARRY_FORWARD shortfall warning when no shortfall.
    expect(
      r.result?.warnings.some((w) => w.includes("carried forward")),
    ).toBe(false)
    // Multi-line aggregation shape — single-line case populates a
    // 1-entry perLine and totals that match the single line.
    expect(r.perLine).toHaveLength(1)
    expect(r.perLine[0]?.lineItemId).toBe("cli-1")
    expect(r.totalScheduledAmortizationDue).toBeCloseTo(10_000, 2)
    expect(r.totalShortfall).toBe(0)
  })

  it("single-line capital + insufficient rebate (CARRY_FORWARD) → shortfall warning emitted", async () => {
    contractFixture = {
      id: "c-1",
      name: "Tie-in c-1",
      vendorId: "v-1",
      contractType: "tie_in",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeSpendTerm([
          makeTier({
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 0.01, // 1% — tiny rebate, will undershoot 10k amort
          }),
        ]),
      ],
      capitalLineItems: [
        makeCapitalItem({
          contractTotal: 120_000,
          interestRate: 0,
          termMonths: 12,
        }),
      ],
    }
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: null,
        quantity: 1,
        unitCost: 50_000,
        extendedPrice: 50_000, // 1% = 500 → 9500 shortfall vs 10k amort
        transactionDate: new Date("2026-02-01"),
      },
    ]
    const r = await getTieInCapitalForContractPeriod({
      contractId: "c-1",
      periodNumber: 1,
    })
    expect(r.result).not.toBeNull()
    expect(r.result?.trueUpAdjustment).toBeGreaterThan(0)
    // Wrapper hard-codes shortfallHandling: "CARRY_FORWARD" → carried-forward warning.
    expect(
      r.result?.warnings.some((w) => w.includes("carried forward")),
    ).toBe(true)
  })

  it("multi-line capital → per-line breakdown + aggregated totals", async () => {
    // Note: a parallel commit (0812f29 "feat(rebates): multi-line tie-in
    // capital per-period wrapper") replaced the original "skip with
    // skipReason" behavior with per-line iteration + aggregation. This
    // test pins the new aggregated-totals shape.
    contractFixture = {
      id: "c-1",
      name: "Tie-in c-1",
      vendorId: "v-1",
      contractType: "tie_in",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeSpendTerm([
          makeTier({ tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 0.5 }),
        ]),
      ],
      capitalLineItems: [
        makeCapitalItem({ id: "cli-1", contractTotal: 120_000, termMonths: 12 }),
        makeCapitalItem({
          id: "cli-2",
          description: "Second device",
          contractTotal: 60_000,
          termMonths: 12,
        }),
      ],
    }
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: null,
        quantity: 1,
        unitCost: 1_000_000,
        extendedPrice: 1_000_000,
        transactionDate: new Date("2026-02-01"),
      },
    ]
    const r = await getTieInCapitalForContractPeriod({ contractId: "c-1" })
    // result is now the FIRST line's engineResult (backward shape).
    expect(r.result).not.toBeNull()
    expect(r.perLine).toHaveLength(2)
    expect(r.perLine[0]?.lineItemId).toBe("cli-1")
    expect(r.perLine[1]?.lineItemId).toBe("cli-2")
    // 120k @ 0% over 12m → 10k/m; 60k @ 0% over 12m → 5k/m. Total = 15k.
    expect(r.totalScheduledAmortizationDue).toBeCloseTo(15_000, 2)
    // 50% rebate on $1M spend per line >> per-line amorts → no shortfall on either line.
    expect(r.perLine[0]?.engineResult.trueUpAdjustment).toBeLessThanOrEqual(0)
    expect(r.perLine[1]?.engineResult.trueUpAdjustment).toBeLessThanOrEqual(0)
    expect(r.totalShortfall).toBe(0)
    // result deep-equals perLine[0].engineResult — backward-compat
    // single-result handle. Use toStrictEqual not toBe: the wrapper
    // passes the return value through `serialize`, which deep-clones,
    // so reference equality won't hold.
    expect(r.result).toStrictEqual(r.perLine[0]?.engineResult)
    // diagnostics carry no skipReason on the eligible-multi-line path.
    expect(r.diagnostics.skipReason).toBeUndefined()
  })

  it("multi-line mixed: line A fully rebated, line B has shortfall → totalShortfall reflects only the deficit line", async () => {
    contractFixture = {
      id: "c-1",
      name: "Tie-in c-1",
      vendorId: "v-1",
      contractType: "tie_in",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeSpendTerm([
          makeTier({
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            rebateValue: 0.01, // 1% rebate
          }),
        ]),
      ],
      capitalLineItems: [
        // Line A: $12k / 12mo → 1k/mo. With 1% rebate on 100k spend
        // = $1k earned. EXACTLY covers line A amort.
        makeCapitalItem({
          id: "cli-A",
          description: "Cheap device",
          contractTotal: 12_000,
          interestRate: 0,
          termMonths: 12,
        }),
        // Line B: $120k / 12mo → 10k/mo. 1% on 100k spend = $1k →
        // 9k shortfall vs B's 10k amort.
        makeCapitalItem({
          id: "cli-B",
          description: "Expensive device",
          contractTotal: 120_000,
          interestRate: 0,
          termMonths: 12,
        }),
      ],
    }
    cogFixture = [
      {
        inventoryNumber: "SKU-A",
        category: null,
        quantity: 1,
        unitCost: 100_000,
        extendedPrice: 100_000, // 1% = $1000 earned per line
        transactionDate: new Date("2026-02-01"),
      },
    ]
    const r = await getTieInCapitalForContractPeriod({
      contractId: "c-1",
      periodNumber: 1,
    })
    expect(r.perLine).toHaveLength(2)
    // Line A: 1k earned vs 1k amort → trueUp = 0
    expect(r.perLine[0]?.engineResult.trueUpAdjustment).toBeCloseTo(0, 2)
    // Line B: 1k earned vs 10k amort → trueUp = +9k (shortfall)
    expect(r.perLine[1]?.engineResult.trueUpAdjustment).toBeCloseTo(9_000, 2)
    // Total shortfall sums positive trueUps only: 9k from B.
    expect(r.totalShortfall).toBeCloseTo(9_000, 2)
    // Total amort: 1k + 10k = 11k.
    expect(r.totalScheduledAmortizationDue).toBeCloseTo(11_000, 2)
    // Total rebate applied is the SUM across lines (each line evals
    // the same shared engine on the same COG). 1k * 2 = 2k.
    expect(r.totalRebateApplied).toBeCloseTo(2_000, 2)
    // Warnings include the carry-forward for line B.
    expect(r.warnings.some((w) => w.includes("carried forward"))).toBe(true)
  })

  it("zero capital line items → returns empty perLine and skipReason", async () => {
    contractFixture = {
      id: "c-1",
      name: "Tie-in c-1",
      vendorId: "v-1",
      contractType: "tie_in",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [
        makeSpendTerm([
          makeTier({ tierNumber: 1, spendMin: 0, spendMax: null, rebateValue: 0.05 }),
        ]),
      ],
      capitalLineItems: [],
    }
    const r = await getTieInCapitalForContractPeriod({ contractId: "c-1" })
    expect(r.result).toBeNull()
    expect(r.perLine).toEqual([])
    expect(r.totalScheduledAmortizationDue).toBe(0)
    expect(r.totalShortfall).toBe(0)
    expect(r.totalRemainingBalance).toBe(0)
    expect(r.diagnostics.skipReason).toMatch(/no ContractCapitalLineItem rows/)
  })
})
