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

describe("createContractTerm — Charles W1.T: capital fields stripped, term-only fields stay", () => {
  it("keeps minimumPurchaseCommitment on the term (per-term concept)", async () => {
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
    // Charles W1.T — capital fields are contract-level now; they must
    // not leak into the ContractTerm create payload.
    expect(callData.capitalCost).toBeUndefined()
    expect(callData.interestRate).toBeUndefined()
    expect(callData.termMonths).toBeUndefined()
    expect(callData.downPayment).toBeUndefined()
    expect(callData.paymentCadence).toBeUndefined()
    expect(callData.amortizationShape).toBeUndefined()
    // Per-term fields stay.
    expect(callData.minimumPurchaseCommitment).toBe(1_320_000)
  })

  it("omits capital fields entirely when the caller doesn't supply them", async () => {
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

    const callData = createMock.mock.calls[0][0].data
    expect(callData.capitalCost).toBeUndefined()
    expect(callData.paymentCadence).toBeUndefined()
  })
})

describe("updateContractTerm — Charles W1.T: capital fields stripped from update", () => {
  it("keeps minimumPurchaseCommitment on the term", async () => {
    await updateContractTerm("term-1", {
      downPayment: 50_000,
      paymentCadence: "annual",
      minimumPurchaseCommitment: 500_000,
    })

    const callData = updateMock.mock.calls[0][0].data
    // Capital fields must be stripped from the term-update payload.
    expect(callData.downPayment).toBeUndefined()
    expect(callData.paymentCadence).toBeUndefined()
    // Per-term fields stay.
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
