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
  deleteContractTerm,
} from "@/lib/actions/contract-terms"

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({
    id: "term-1",
    tiers: [],
  })
  updateMock.mockResolvedValue({
    id: "term-1",
    contractId: "c-1",
    tiers: [],
  })
  deleteTermMock.mockResolvedValue({ id: "term-1" })
  findUniqueTermMock.mockResolvedValue({ contractId: "c-1" })
  createManyProductMock.mockResolvedValue({ count: 0 })
  deleteManyProductMock.mockResolvedValue({ count: 0 })
  recomputeAccrualMock.mockResolvedValue({ deleted: 0, inserted: 0 })
})

describe("createContractTerm — scope-field destructuring", () => {
  it("does not pass scopedCategoryId into prisma.contractTerm.create", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Test",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      rebateMethod: "cumulative",
      appliesTo: "specific_category",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-01-01",
      scopedCategoryId: "cat-1",
      scopedCategoryIds: ["cat-1", "cat-2"],
      scopedItemNumbers: ["STK-1", "STK-2"],
      tiers: [],
    })
    const callData = createMock.mock.calls[0][0].data
    expect(callData.scopedCategoryId).toBeUndefined()
    expect(callData.scopedCategoryIds).toBeUndefined()
    expect(callData.scopedItemNumbers).toBeUndefined()
  })

  it("writes scopedCategoryIds into the categories column", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Test",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      rebateMethod: "cumulative",
      appliesTo: "specific_category",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-01-01",
      scopedCategoryIds: ["cat-1", "cat-2"],
      tiers: [],
    })
    const callData = createMock.mock.calls[0][0].data
    expect(callData.categories).toEqual(["cat-1", "cat-2"])
  })

  it("writes scopedItemNumbers as ContractTermProduct rows", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Test",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      rebateMethod: "cumulative",
      appliesTo: "specific_items",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-01-01",
      scopedItemNumbers: ["STK-1", "STK-2"],
      tiers: [],
    })
    expect(createManyProductMock).toHaveBeenCalledWith({
      data: [
        { termId: "term-1", vendorItemNo: "STK-1" },
        { termId: "term-1", vendorItemNo: "STK-2" },
      ],
      skipDuplicates: true,
    })
  })
})

describe("updateContractTerm — scope-field destructuring", () => {
  it("does not pass scopedCategoryId into prisma.contractTerm.update", async () => {
    await updateContractTerm("term-1", {
      scopedCategoryId: "cat-1",
      scopedCategoryIds: ["cat-1"],
      scopedItemNumbers: ["STK-1"],
    })
    const callData = updateMock.mock.calls[0][0].data
    expect(callData.scopedCategoryId).toBeUndefined()
    expect(callData.scopedCategoryIds).toBeUndefined()
    expect(callData.scopedItemNumbers).toBeUndefined()
  })

  it("replaces ContractTermProduct rows (deleteMany + createMany)", async () => {
    await updateContractTerm("term-1", {
      scopedItemNumbers: ["STK-NEW"],
    })
    expect(deleteManyProductMock).toHaveBeenCalledWith({
      where: { termId: "term-1" },
    })
    expect(createManyProductMock).toHaveBeenCalledWith({
      data: [{ termId: "term-1", vendorItemNo: "STK-NEW" }],
      skipDuplicates: true,
    })
  })
})

// ─── Charles R5.21: accrual recompute trigger ───────────────────────
// Term saves must regenerate Rebate rows from the current term +
// tier configuration, otherwise a `evaluationPeriod` edit leaves the
// detail-page "Rebates Earned" card showing the stale $0 computed
// from the pre-edit cadence.
describe("term save triggers accrual recompute (R5.21)", () => {
  it("createContractTerm calls recomputeAccrualForContract with the new contractId", async () => {
    await createContractTerm({
      contractId: "c-1",
      termName: "Test",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "monthly",
      paymentTiming: "quarterly",
      rebateMethod: "cumulative",
      appliesTo: "all_products",
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-01-01",
      tiers: [],
    })
    expect(recomputeAccrualMock).toHaveBeenCalledWith("c-1")
  })

  it("updateContractTerm calls recomputeAccrualForContract with the term's contractId", async () => {
    await updateContractTerm("term-1", {
      evaluationPeriod: "monthly",
    })
    expect(recomputeAccrualMock).toHaveBeenCalledWith("c-1")
  })

  it("deleteContractTerm calls recomputeAccrualForContract so the card drops stale accruals", async () => {
    await deleteContractTerm("term-1")
    expect(findUniqueTermMock).toHaveBeenCalledWith({
      where: { id: "term-1" },
      select: { contractId: true },
    })
    expect(recomputeAccrualMock).toHaveBeenCalledWith("c-1")
  })
})

// ─── Charles R5.36 P0: accrual recompute is non-fatal ──────────────
// The edit-contract save flow is:
//   updateContract → updateContractTerm(s) → upsertContractTiers(s)
// If any of those server actions threw, the client's sequential await
// loop aborted and `router.push` never ran — leaving the user on the
// edit page with a "Contract updated successfully" toast but
// partially-committed term/tier writes. The most likely throw source
// is the downstream `recomputeAccrualForContract` rebuild (malformed
// tier, missing COG, etc.). It must be non-fatal for the user-visible
// term/tier write, the same way `recomputeContractScore` is wrapped
// in `.catch(warn)` inside `updateContract`.
describe("accrual recompute is non-fatal for term writes (R5.36 P0)", () => {
  it("updateContractTerm still resolves (and persists the update) when the recompute throws", async () => {
    recomputeAccrualMock.mockRejectedValueOnce(new Error("recompute exploded"))
    await expect(
      updateContractTerm("term-1", { termName: "Rename" }),
    ).resolves.toBeDefined()
    // The underlying prisma update DID fire — the save was committed
    // before the recompute was attempted.
    expect(updateMock).toHaveBeenCalled()
  })

  it("createContractTerm still resolves when the recompute throws", async () => {
    recomputeAccrualMock.mockRejectedValueOnce(new Error("recompute exploded"))
    await expect(
      createContractTerm({
        contractId: "c-1",
        termName: "Test",
        termType: "spend_rebate",
        baselineType: "spend_based",
        evaluationPeriod: "monthly",
        paymentTiming: "quarterly",
        rebateMethod: "cumulative",
        appliesTo: "all_products",
        effectiveStart: "2026-01-01",
        effectiveEnd: "2027-01-01",
        tiers: [],
      }),
    ).resolves.toBeDefined()
    expect(createMock).toHaveBeenCalled()
  })

  it("deleteContractTerm still resolves when the recompute throws", async () => {
    recomputeAccrualMock.mockRejectedValueOnce(new Error("recompute exploded"))
    await expect(deleteContractTerm("term-1")).resolves.toBeUndefined()
    expect(deleteTermMock).toHaveBeenCalled()
  })
})
