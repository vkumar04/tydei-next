/**
 * Wave B (tie-in parity) — ContractTerm persists three new capital
 * fields: downPayment, paymentCadence, minimumPurchaseCommitment. The
 * tests here assert both the server-action write path (createContractTerm
 * / updateContractTerm) forwards the fields through to Prisma, and that
 * the amortization-schedule helper subtracts downPayment from
 * capitalCost before invoking the pure engine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  createMock,
  updateMock,
  deleteTermMock,
  findUniqueTermMock,
  createManyProductMock,
  deleteManyProductMock,
  recomputeAccrualMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteTermMock: vi.fn(),
  findUniqueTermMock: vi.fn(),
  createManyProductMock: vi.fn(),
  deleteManyProductMock: vi.fn(),
  recomputeAccrualMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contractTerm: {
      create: createMock,
      update: updateMock,
      delete: deleteTermMock,
      findUnique: findUniqueTermMock,
    },
    contractTermProduct: {
      createMany: createManyProductMock,
      deleteMany: deleteManyProductMock,
    },
    contractAmortizationSchedule: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
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
import { buildScheduleForTerm } from "@/lib/contracts/tie-in-schedule"

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({ id: "term-1", tiers: [] })
  updateMock.mockResolvedValue({
    id: "term-1",
    contractId: "c-1",
    tiers: [],
  })
  findUniqueTermMock.mockResolvedValue({ contractId: "c-1" })
  createManyProductMock.mockResolvedValue({ count: 0 })
  deleteManyProductMock.mockResolvedValue({ count: 0 })
  recomputeAccrualMock.mockResolvedValue({ deleted: 0, inserted: 0 })
})

describe("createContractTerm — Wave B capital fields", () => {
  it("persists downPayment / paymentCadence / minimumPurchaseCommitment", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Mako tie-in",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      rebateMethod: "cumulative",
      appliesTo: "all_products",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2031-01-01",
      capitalCost: 1_250_000,
      interestRate: 0.05,
      termMonths: 60,
      downPayment: 125_000,
      paymentCadence: "quarterly",
      minimumPurchaseCommitment: 1_320_000,
      tiers: [],
    })

    const callData = createMock.mock.calls[0][0].data
    expect(callData.capitalCost).toBe(1_250_000)
    expect(callData.downPayment).toBe(125_000)
    expect(callData.paymentCadence).toBe("quarterly")
    expect(callData.minimumPurchaseCommitment).toBe(1_320_000)
  })

  it("lets Prisma apply the paymentCadence default when omitted", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Defaults check",
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

    // When the caller omits paymentCadence the server action leaves it
    // undefined and Prisma falls back to its schema-level default
    // (`@default(monthly)`). Passing `monthly` explicitly is also fine
    // but we avoid double-defaulting in the validator to keep existing
    // call sites (new-contract-client, vendor-submission) working
    // without forcing them to pass the field.
    const callData = createMock.mock.calls[0][0].data
    expect(callData.paymentCadence).toBeUndefined()
  })
})

describe("updateContractTerm — Wave B capital fields", () => {
  it("persists downPayment / paymentCadence / minimumPurchaseCommitment", async () => {
    await updateContractTerm("term-1", {
      downPayment: 50_000,
      paymentCadence: "annual",
      minimumPurchaseCommitment: 500_000,
    })

    const callData = updateMock.mock.calls[0][0].data
    expect(callData.downPayment).toBe(50_000)
    expect(callData.paymentCadence).toBe("annual")
    expect(callData.minimumPurchaseCommitment).toBe(500_000)
  })
})

describe("buildScheduleForTerm — downPayment reduces opening balance", () => {
  it("subtracts downPayment from capitalCost before building the schedule", () => {
    const schedule = buildScheduleForTerm({
      capitalCost: 100_000,
      downPayment: 20_000,
      interestRate: 0,
      termMonths: 12,
      paymentCadence: "monthly",
    })

    expect(schedule).toHaveLength(12)
    // Opening balance on period 1 equals capitalCost - downPayment.
    expect(schedule[0]!.openingBalance).toBe(80_000)
  })

  it("treats missing downPayment as zero (opening balance = capitalCost)", () => {
    const schedule = buildScheduleForTerm({
      capitalCost: 100_000,
      interestRate: 0,
      termMonths: 12,
      paymentCadence: "monthly",
    })

    expect(schedule[0]!.openingBalance).toBe(100_000)
  })

  it("clamps effective principal at zero when downPayment exceeds capitalCost", () => {
    const schedule = buildScheduleForTerm({
      capitalCost: 100_000,
      downPayment: 150_000,
      interestRate: 0.05,
      termMonths: 12,
      paymentCadence: "monthly",
    })

    expect(schedule).toEqual([])
  })

  it("defaults cadence to monthly when omitted", () => {
    const schedule = buildScheduleForTerm({
      capitalCost: 60_000,
      interestRate: 0,
      termMonths: 12,
    })

    expect(schedule).toHaveLength(12)
  })
})
