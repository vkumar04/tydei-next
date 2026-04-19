/**
 * Wave D — amortization-shape persistence + preview contract tests.
 *
 * Covers the three behaviours Charles flagged in the feedback:
 *   1. Symmetrical preview seeds compute cleanly from
 *      buildScheduleForTerm when capitalCost + interestRate + termMonths
 *      are all set.
 *   2. Custom-mode persistence: saving a term with 5 user-entered rows
 *      writes 5 ContractAmortizationSchedule rows via createMany and
 *      clears any previous rows first.
 *   3. Toggle flip — symmetrical → custom preserves the engine numbers
 *      as seed values (the component reads from buildScheduleForTerm);
 *      custom → symmetrical clears the persisted rows so read paths
 *      fall back to live compute.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildScheduleForTerm } from "@/lib/contracts/tie-in-schedule"

const {
  createMock,
  updateMock,
  findUniqueTermMock,
  amortDeleteManyMock,
  amortCreateManyMock,
  createManyProductMock,
  deleteManyProductMock,
  recomputeAccrualMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  findUniqueTermMock: vi.fn(),
  amortDeleteManyMock: vi.fn(),
  amortCreateManyMock: vi.fn(),
  createManyProductMock: vi.fn(),
  deleteManyProductMock: vi.fn(),
  recomputeAccrualMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contractTerm: {
      create: createMock,
      update: updateMock,
      delete: vi.fn(),
      findUnique: findUniqueTermMock,
    },
    contractTermProduct: {
      createMany: createManyProductMock,
      deleteMany: deleteManyProductMock,
    },
    contractAmortizationSchedule: {
      deleteMany: amortDeleteManyMock,
      createMany: amortCreateManyMock,
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
vi.mock("@/lib/actions/contracts/recompute-accrual", () => ({
  recomputeAccrualForContract: recomputeAccrualMock,
}))

import {
  createContractTerm,
  updateContractTerm,
} from "@/lib/actions/contract-terms"

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({ id: "term-1", tiers: [] })
  updateMock.mockResolvedValue({
    id: "term-1",
    contractId: "c-1",
    tiers: [],
  })
  findUniqueTermMock.mockResolvedValue({ contractId: "c-1" })
  amortDeleteManyMock.mockResolvedValue({ count: 0 })
  amortCreateManyMock.mockResolvedValue({ count: 0 })
  createManyProductMock.mockResolvedValue({ count: 0 })
  deleteManyProductMock.mockResolvedValue({ count: 0 })
  recomputeAccrualMock.mockResolvedValue({ deleted: 0, inserted: 0 })
})

describe("Wave D — inline symmetrical preview", () => {
  it("produces a non-empty schedule when capital / interest / term are set", () => {
    const schedule = buildScheduleForTerm({
      capitalCost: 120_000,
      downPayment: 20_000,
      interestRate: 0.06,
      termMonths: 12,
      paymentCadence: "monthly",
    })
    expect(schedule).toHaveLength(12)
    // Opening balance on period 1 = capitalCost - downPayment.
    expect(schedule[0]!.openingBalance).toBe(100_000)
    // Final closing balance ≈ 0 (PMT clears the principal).
    expect(Math.abs(schedule[11]!.closingBalance)).toBeLessThan(0.01)
  })

  it("returns [] when required inputs are missing so the form shows empty state", () => {
    expect(
      buildScheduleForTerm({
        capitalCost: null,
        interestRate: 0.05,
        termMonths: 12,
        paymentCadence: "monthly",
      }),
    ).toEqual([])
    expect(
      buildScheduleForTerm({
        capitalCost: 100_000,
        interestRate: 0.05,
        termMonths: null,
        paymentCadence: "monthly",
      }),
    ).toEqual([])
  })
})

describe("Wave D — custom-mode persistence (updateContractTerm)", () => {
  it("writes one ContractAmortizationSchedule row per custom entry", async () => {
    await updateContractTerm("term-1", {
      amortizationShape: "custom",
      capitalCost: 100_000,
      downPayment: 0,
      interestRate: 0,
      termMonths: 5,
      paymentCadence: "monthly",
      customAmortizationRows: [
        { periodNumber: 1, amortizationDue: 30_000 },
        { periodNumber: 2, amortizationDue: 20_000 },
        { periodNumber: 3, amortizationDue: 20_000 },
        { periodNumber: 4, amortizationDue: 15_000 },
        { periodNumber: 5, amortizationDue: 15_000 },
      ],
    })

    // Delete-first then createMany.
    expect(amortDeleteManyMock).toHaveBeenCalledWith({
      where: { termId: "term-1" },
    })
    expect(amortCreateManyMock).toHaveBeenCalledTimes(1)
    const rows = amortCreateManyMock.mock.calls[0][0].data
    expect(rows).toHaveLength(5)
    // Amortization-due values round-trip exactly.
    expect(rows.map((r: { amortizationDue: number }) => r.amortizationDue)).toEqual([
      30_000, 20_000, 20_000, 15_000, 15_000,
    ])
    // Period 1 opens at 100k (no down payment, zero interest).
    expect(rows[0].openingBalance).toBe(100_000)
    // With zero interest, each closing balance drops by the period's
    // amortizationDue — terminal row should end at 0.
    expect(rows[4].closingBalance).toBe(0)
  })
})

describe("Wave D — toggle flip behaviour", () => {
  it("symmetrical → custom: seeds from the engine when no custom rows yet", () => {
    // Pre-flip, the form's symmetricalSchedule memo is what the custom
    // table displays on its first render — asserting it matches the
    // engine output locks in the "preserve computed numbers as seed"
    // contract.
    const seed = buildScheduleForTerm({
      capitalCost: 60_000,
      interestRate: 0,
      termMonths: 6,
      paymentCadence: "monthly",
    })
    expect(seed).toHaveLength(6)
    // Equal $10k payments for zero-interest.
    for (const row of seed) {
      expect(row.amortizationDue).toBeCloseTo(10_000, 2)
    }
  })

  it("custom → symmetrical: clears ContractAmortizationSchedule rows", async () => {
    await updateContractTerm("term-1", {
      amortizationShape: "symmetrical",
      capitalCost: 100_000,
      interestRate: 0.05,
      termMonths: 12,
      paymentCadence: "monthly",
    })

    // Symmetrical write path ALWAYS nukes the table so read fallback
    // uses the live engine.
    expect(amortDeleteManyMock).toHaveBeenCalledWith({
      where: { termId: "term-1" },
    })
    expect(amortCreateManyMock).not.toHaveBeenCalled()
  })

  it("createContractTerm with no shape defaults to symmetrical (clears rows)", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Defaults",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      rebateMethod: "cumulative",
      appliesTo: "all_products",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-01-01",
      tiers: [],
    })

    expect(amortDeleteManyMock).toHaveBeenCalledWith({
      where: { termId: "term-1" },
    })
    expect(amortCreateManyMock).not.toHaveBeenCalled()
  })
})
