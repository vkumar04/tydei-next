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
