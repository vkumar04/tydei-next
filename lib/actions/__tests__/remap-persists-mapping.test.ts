/**
 * #1 (Vick 2026-05-31): remapping a vendor name must PERSIST a confirmed
 * per-facility rule (so future imports auto-apply it), and unmapping must
 * remove it. We mock prisma + the recompute/refresh side effects and only
 * assert the VendorNameMapping write.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const cogFindMany = vi.fn(async (_a?: unknown) => [] as { vendorId: string | null }[])
const vendorFindUnique = vi.fn(async (_a?: unknown) => ({
  id: "v1",
  name: "Stryker",
  displayName: null,
}))
const cogUpdateMany = vi.fn(async (_a?: unknown) => ({ count: 5 }))
const mappingUpsert = vi.fn(async (_a?: unknown) => ({}))
const mappingDeleteMany = vi.fn(async (_a?: unknown) => ({ count: 1 }))

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: (a: unknown) => cogFindMany(a),
      updateMany: (a: unknown) => cogUpdateMany(a),
    },
    vendor: { findUnique: (a: unknown) => vendorFindUnique(a) },
    vendorNameMapping: {
      upsert: (a: unknown) => mappingUpsert(a),
      deleteMany: (a: unknown) => mappingDeleteMany(a),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({ facility: { id: "f1" }, user: { id: "u1" } }),
}))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: vi.fn(async () => {}),
}))
vi.mock("@/lib/actions/contracts/refresh-metrics", () => ({
  refreshContractMetricsForVendor: vi.fn(async () => ({})),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

describe("remapCOGVendorName — rule persistence", () => {
  beforeEach(() => vi.clearAllMocks())

  it("upserts a confirmed per-facility rule when mapping to a vendor", async () => {
    const { remapCOGVendorName } = await import("@/lib/actions/cog-vendor-mapping")
    await remapCOGVendorName({ vendorName: "Howmedica", newVendorId: "v1" })

    expect(mappingUpsert).toHaveBeenCalledTimes(1)
    const arg = mappingUpsert.mock.calls[0][0] as {
      where: { facilityId_cogVendorName: { facilityId: string; cogVendorName: string } }
      create: { facilityId: string; cogVendorName: string; mappedVendorId: string; isConfirmed: boolean }
    }
    expect(arg.where.facilityId_cogVendorName).toEqual({
      facilityId: "f1",
      cogVendorName: "Howmedica",
    })
    expect(arg.create).toMatchObject({
      facilityId: "f1",
      cogVendorName: "Howmedica",
      mappedVendorId: "v1",
      isConfirmed: true,
    })
    expect(mappingDeleteMany).not.toHaveBeenCalled()
  })

  it("deletes the rule on unmap (newVendorId = null)", async () => {
    const { remapCOGVendorName } = await import("@/lib/actions/cog-vendor-mapping")
    await remapCOGVendorName({ vendorName: "Howmedica", newVendorId: null })

    expect(mappingDeleteMany).toHaveBeenCalledWith({
      where: { facilityId: "f1", cogVendorName: "Howmedica" },
    })
    expect(mappingUpsert).not.toHaveBeenCalled()
  })
})
