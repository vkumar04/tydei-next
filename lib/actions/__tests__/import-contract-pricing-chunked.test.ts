/**
 * Feature 5 (uploader improvement 5, 2026-06-13): importContractPricing
 * gains `mode` + `skipPostProcessing` so a large catalog can be imported in
 * chunks (chunk 0 = replace+skipPost, middle = append+skipPost, last =
 * append+run-post).
 *
 *   - mode "replace" (default): deleteMany the contract's prior rows, insert.
 *   - mode "append": skip the deleteMany, only insert.
 *   - skipPostProcessing: none of the trailing post-processing
 *     (carve-out auto-create/populate, match recompute, metrics refresh,
 *     accrual recompute, remap persist) runs — the caller runs it once on
 *     the final chunk.
 *
 * Same action-test mock pattern as import-contract-pricing-category.test.ts,
 * extended to mock the post-processing helpers so we can assert they're NOT
 * invoked when skipped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const contractFindUniqueOrThrow = vi.fn(async (_a?: unknown) => ({
  id: "c1",
  vendorId: "v1",
  additionalVendorIds: [] as string[],
}))
const createManyMock = vi.fn(async (args: { data: unknown[] }) => ({
  count: args.data.length,
}))
const deleteManyMock = vi.fn(async (_a?: unknown) => ({ count: 0 }))

const ensureCarveOutMock = vi.fn(async (_id?: string) => ({ created: false }))
const populateCarveOutMock = vi.fn(async (_id?: string) => ({
  termsFound: 0,
  productsLinked: 0,
  carveOutSkuCount: 0,
}))
const recomputeMatchMock = vi.fn(async (..._a: unknown[]) => undefined)
const refreshMetricsMock = vi.fn(async (..._a: unknown[]) => undefined)
const recomputeAccrualMock = vi.fn(async (_id?: string) => undefined)

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: (a: unknown) => contractFindUniqueOrThrow(a),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        contractPricing: {
          deleteMany: (a: unknown) => deleteManyMock(a),
          createMany: (a: { data: unknown[] }) => createManyMock(a),
        },
      }),
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({ facility: { id: "fac-1" }, user: { id: "u1" } }),
  requireVendor: async () => ({ vendor: { id: "v1" } }),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
}))

vi.mock("@/lib/categories/resolve", () => ({
  resolveCategoryNamesBulk: async () => new Map<string, string>(),
  isPlaceholderCategory: (s: string) =>
    !s?.trim() || /^[\d.,\s/+\-–—]+$/.test(s.trim()),
  removeInverseCategoryMapping: async () => undefined,
}))

vi.mock("@/lib/categories/apply-category-remap", () => ({
  applyCategoryRemap: (raw: string | undefined | null) => raw ?? undefined,
}))

vi.mock("@/lib/contracts/populate-carveout-terms", () => ({
  ensureCarveOutTermFromPricing: (id: string) => ensureCarveOutMock(id),
  populateCarveOutTermsForContract: (id: string) => populateCarveOutMock(id),
}))

vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (...a: unknown[]) => recomputeMatchMock(...a),
}))

vi.mock("@/lib/actions/contracts/recompute-accrual", () => ({
  recomputeAccrualForContract: (id: string) => recomputeAccrualMock(id),
}))

vi.mock("@/lib/actions/contracts/refresh-metrics", () => ({
  refreshContractMetricsForVendor: (...a: unknown[]) => refreshMetricsMock(...a),
}))

const item = (sku: string) => ({ vendorItemNo: sku, unitPrice: 10 })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("importContractPricing — mode (feature 5)", () => {
  it("default (replace) deletes prior rows before inserting", async () => {
    const { importContractPricing } = await import("@/lib/actions/pricing-files")
    await importContractPricing({ contractId: "c1", items: [item("A")] })
    expect(deleteManyMock).toHaveBeenCalledTimes(1)
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { contractId: "c1" } })
    expect(createManyMock).toHaveBeenCalledTimes(1)
  })

  it("mode 'replace' explicitly performs the deleteMany", async () => {
    const { importContractPricing } = await import("@/lib/actions/pricing-files")
    await importContractPricing({
      contractId: "c1",
      items: [item("A")],
      mode: "replace",
    })
    expect(deleteManyMock).toHaveBeenCalledTimes(1)
  })

  it("mode 'append' SKIPS the deleteMany but still inserts", async () => {
    const { importContractPricing } = await import("@/lib/actions/pricing-files")
    await importContractPricing({
      contractId: "c1",
      items: [item("B")],
      mode: "append",
    })
    expect(deleteManyMock).not.toHaveBeenCalled()
    expect(createManyMock).toHaveBeenCalledTimes(1)
  })
})

describe("importContractPricing — skipPostProcessing (feature 5)", () => {
  it("does NOT run any post-processing when skipPostProcessing is true", async () => {
    const { importContractPricing } = await import("@/lib/actions/pricing-files")
    const res = await importContractPricing({
      contractId: "c1",
      items: [item("A")],
      mode: "append",
      skipPostProcessing: true,
    })
    expect(ensureCarveOutMock).not.toHaveBeenCalled()
    expect(populateCarveOutMock).not.toHaveBeenCalled()
    expect(recomputeMatchMock).not.toHaveBeenCalled()
    expect(refreshMetricsMock).not.toHaveBeenCalled()
    expect(recomputeAccrualMock).not.toHaveBeenCalled()
    expect(res).toMatchObject({ imported: 1, carveOutLinked: 0, carveOutTermCreated: false })
  })

  it("runs the full post-processing on the final chunk (skipPostProcessing false)", async () => {
    const { importContractPricing } = await import("@/lib/actions/pricing-files")
    await importContractPricing({
      contractId: "c1",
      items: [item("A")],
      mode: "append",
      skipPostProcessing: false,
    })
    expect(ensureCarveOutMock).toHaveBeenCalledTimes(1)
    expect(populateCarveOutMock).toHaveBeenCalledTimes(1)
    expect(recomputeMatchMock).toHaveBeenCalledTimes(1)
    expect(refreshMetricsMock).toHaveBeenCalledTimes(1)
    expect(recomputeAccrualMock).toHaveBeenCalledTimes(1)
  })

  it("default call (no skip) runs post-processing — backward compatible", async () => {
    const { importContractPricing } = await import("@/lib/actions/pricing-files")
    await importContractPricing({ contractId: "c1", items: [item("A")] })
    expect(recomputeAccrualMock).toHaveBeenCalledTimes(1)
  })
})

describe("importContractPricing — chunked sequence end-to-end (feature 5)", () => {
  it("first=replace+skip, middle=append+skip, last=append+run", async () => {
    const { importContractPricing } = await import("@/lib/actions/pricing-files")

    // chunk 0
    await importContractPricing({
      contractId: "c1",
      items: [item("A")],
      mode: "replace",
      skipPostProcessing: true,
    })
    // chunk 1 (middle)
    await importContractPricing({
      contractId: "c1",
      items: [item("B")],
      mode: "append",
      skipPostProcessing: true,
    })
    // chunk 2 (last)
    await importContractPricing({
      contractId: "c1",
      items: [item("C")],
      mode: "append",
      skipPostProcessing: false,
    })

    // deleteMany only on the first (replace) chunk.
    expect(deleteManyMock).toHaveBeenCalledTimes(1)
    // insert ran for all three chunks.
    expect(createManyMock).toHaveBeenCalledTimes(3)
    // post-processing ran exactly once (the last chunk).
    expect(recomputeAccrualMock).toHaveBeenCalledTimes(1)
    expect(ensureCarveOutMock).toHaveBeenCalledTimes(1)
  })
})
