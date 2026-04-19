import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  createMock,
  updateMock,
  createManyProductMock,
  deleteManyProductMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  createManyProductMock: vi.fn(),
  deleteManyProductMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contractTerm: { create: createMock, update: updateMock },
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

import {
  createContractTerm,
  updateContractTerm,
} from "@/lib/actions/contract-terms"

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({
    id: "term-1",
    tiers: [],
  })
  updateMock.mockResolvedValue({
    id: "term-1",
    tiers: [],
  })
  createManyProductMock.mockResolvedValue({ count: 0 })
  deleteManyProductMock.mockResolvedValue({ count: 0 })
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
