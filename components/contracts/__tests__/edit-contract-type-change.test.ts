import { describe, it, expect, vi, beforeEach } from "vitest"

// Charles W1.W-E3 — editing a contract where the user changes
// contractType (e.g. pricing_only → usage) AND adds a new term with
// tiers must persist both. The suspect path was the edit-save handler
// losing the tiers on the new term, or the contractType update
// shadowing the term create.
//
// This test runs the same two server actions the client invokes, in
// the same order, and asserts every field lands in prisma.

const {
  updateContractMock,
  findUniqueOrThrowMock,
  termCreateMock,
  termUpdateMock,
  recomputeAccrualMock,
  recomputeScoreMock,
  recomputeVendorMock,
} = vi.hoisted(() => ({
  updateContractMock: vi.fn(),
  findUniqueOrThrowMock: vi.fn(),
  termCreateMock: vi.fn(),
  termUpdateMock: vi.fn(),
  recomputeAccrualMock: vi.fn(),
  recomputeScoreMock: vi.fn(),
  recomputeVendorMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      update: updateContractMock,
      findUniqueOrThrow: findUniqueOrThrowMock,
      // W2.A.1 H-B: updateContract re-reads the contract after update
      // to build the multi-facility recompute set.
      findUnique: vi.fn().mockResolvedValue({
        facilityId: "fac-1",
        contractFacilities: [],
      }),
    },
    contractFacility: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    contractProductCategory: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    contractAmortizationSchedule: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    contractTerm: {
      create: termCreateMock,
      update: termUpdateMock,
    },
    contractTermProduct: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: recomputeVendorMock,
}))
vi.mock("@/lib/actions/contracts/scoring", () => ({
  recomputeContractScore: recomputeScoreMock,
}))
vi.mock("@/lib/actions/contracts/recompute-accrual", () => ({
  recomputeAccrualForContract: recomputeAccrualMock,
}))
vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(v: T) => v,
}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}))

import { updateContract } from "@/lib/actions/contracts"
import { createContractTerm } from "@/lib/actions/contract-terms"

beforeEach(() => {
  vi.clearAllMocks()
  updateContractMock.mockResolvedValue({
    id: "c-1",
    contractType: "usage",
  })
  findUniqueOrThrowMock.mockResolvedValue({ id: "c-1" })
  termCreateMock.mockResolvedValue({
    id: "term-new-1",
    contractId: "c-1",
    tiers: [],
  })
  termUpdateMock.mockResolvedValue({
    id: "term-new-1",
    contractId: "c-1",
    tiers: [],
  })
  recomputeAccrualMock.mockResolvedValue({ deleted: 0, inserted: 0 })
  recomputeScoreMock.mockResolvedValue(undefined)
  recomputeVendorMock.mockResolvedValue(undefined)
})

describe("edit-contract type change + new term persistence (W1.W-E3)", () => {
  it("persists the contractType change to usage via prisma.contract.update", async () => {
    await updateContract("c-1", {
      contractType: "usage",
    })
    const callData = updateContractMock.mock.calls[0][0].data
    expect(callData.contractType).toBe("usage")
  })

  it("persists a new term with tiers when the save loop hits createContractTerm", async () => {
    // This mirrors the edit-contract-client handleSave path: when a
    // term has no id, the client calls createContractTerm({...term,
    // contractId}). The term object carries the full tier array from
    // form state. The regression bug was these tiers being dropped.
    await createContractTerm({
      contractId: "c-1",
      termName: "Growth Rebate",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      appliesTo: "all_products",
      rebateMethod: "cumulative",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2026-12-31",
      tiers: [
        {
          tierNumber: 1,
          spendMin: 0,
          spendMax: 500_000,
          rebateType: "percent_of_spend",
          rebateValue: 0.02,
        },
        {
          tierNumber: 2,
          // Charles 2026-04-25 Bug 21: tier overlap (tier 2 spendMin
          // == tier 1 spendMax) now rejected at validation. Stepping
          // tier 2 to spendMax+1 keeps the original test intent (a
          // two-tier rebate) without tripping the overlap check.
          spendMin: 500_001,
          rebateType: "percent_of_spend",
          rebateValue: 0.04,
        },
      ],
    })

    const callArgs = termCreateMock.mock.calls[0][0]
    expect(callArgs.data.tiers).toBeDefined()
    expect(callArgs.data.tiers.create).toHaveLength(2)
    expect(callArgs.data.tiers.create[0].rebateValue).toBe(0.02)
    expect(callArgs.data.tiers.create[1].rebateValue).toBe(0.04)
    expect(callArgs.data.tiers.create[0].spendMin).toBe(0)
    expect(callArgs.data.tiers.create[1].spendMin).toBe(500_001)
  })

  it("runs both steps in sequence: contract type update, then term create — fields round-trip", async () => {
    // Step 1: update the contract row with the new type.
    await updateContract("c-1", {
      contractType: "usage",
      name: "Renamed Contract",
    })
    expect(updateContractMock).toHaveBeenCalledTimes(1)
    expect(updateContractMock.mock.calls[0][0].data.contractType).toBe("usage")

    // Step 2: create the new term with one tier (the "user added a
    // rebate tier" half of the scenario).
    await createContractTerm({
      contractId: "c-1",
      termName: "New Rebate Term",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      appliesTo: "all_products",
      rebateMethod: "cumulative",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2026-12-31",
      tiers: [
        {
          tierNumber: 1,
          spendMin: 0,
          rebateType: "percent_of_spend",
          rebateValue: 0.03,
        },
      ],
    })

    expect(termCreateMock).toHaveBeenCalledTimes(1)
    const termCreateData = termCreateMock.mock.calls[0][0].data
    expect(termCreateData.contractId).toBe("c-1")
    expect(termCreateData.termType).toBe("spend_rebate")
    expect(termCreateData.tiers.create).toHaveLength(1)
    expect(termCreateData.tiers.create[0].rebateValue).toBe(0.03)
  })

  it("accepts a term whose effectiveStart was seeded from the contract's dates (no min(1) failure)", async () => {
    // Charles W1.W-E3: the edit-client seeds blank effectiveStart /
    // effectiveEnd from the contract's own dates so `createTermSchema`
    // doesn't fail validation mid-save and silently drop the new term.
    await createContractTerm({
      contractId: "c-1",
      termName: "Seeded Term",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      appliesTo: "all_products",
      rebateMethod: "cumulative",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2026-12-31",
      tiers: [
        {
          tierNumber: 1,
          spendMin: 0,
          rebateType: "percent_of_spend",
          rebateValue: 0.03,
        },
      ],
    })
    expect(termCreateMock).toHaveBeenCalledTimes(1)
    expect(termCreateMock.mock.calls[0][0].data.tiers.create).toHaveLength(1)
  })

  it("does NOT create a term with empty tiers when the caller supplied a non-empty array", async () => {
    // Guard against a regression where `tiers: z.array(...).default([])`
    // somehow overwrote a populated array. The validator is idempotent
    // on provided arrays; this just documents it.
    await createContractTerm({
      contractId: "c-1",
      termName: "Tier Regression Guard",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      appliesTo: "all_products",
      rebateMethod: "cumulative",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2026-12-31",
      tiers: [
        {
          tierNumber: 1,
          spendMin: 0,
          rebateType: "percent_of_spend",
          rebateValue: 0.05,
        },
      ],
    })
    const callData = termCreateMock.mock.calls[0][0].data
    expect(callData.tiers).toBeDefined()
    expect(callData.tiers.create).toHaveLength(1)
  })
})
