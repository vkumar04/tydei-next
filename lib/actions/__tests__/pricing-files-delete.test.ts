/**
 * Regression coverage for `deletePricingFile` and
 * `deletePricingFilesByVendor` (Charles feedback round 3, Task 4).
 *
 * We mock Prisma + auth so we only exercise the action's own control
 * flow: facility-scope guard, related `ContractPricing` cleanup,
 * `PricingFile` deletion, and audit logging.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = { id: string; vendorId: string; vendorItemNo: string }

const pricingFindFirstMock = vi.fn()
const pricingFindManyMock = vi.fn()
const pricingDeleteMock = vi.fn()
const pricingDeleteManyMock = vi.fn()
const contractPricingDeleteManyMock = vi.fn()
const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})

vi.mock("@/lib/db", () => ({
  prisma: {
    pricingFile: {
      findFirst: (args: unknown) => pricingFindFirstMock(args),
      findMany: (args: unknown) => pricingFindManyMock(args),
      delete: (args: unknown) => pricingDeleteMock(args),
      deleteMany: (args: unknown) => pricingDeleteManyMock(args),
    },
    contractPricing: {
      deleteMany: (args: unknown) => contractPricingDeleteManyMock(args),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  }),
}))

vi.mock("@/lib/audit", () => ({
  logAudit: (args: Record<string, unknown>) => logAuditMock(args),
}))

// Avoid importing the whole serialize + zod validator chain.
vi.mock("@/lib/serialize", () => ({ serialize: <T>(v: T) => v }))

describe("deletePricingFile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("refuses to delete a row from another facility", async () => {
    pricingFindFirstMock.mockResolvedValueOnce(null)
    const { deletePricingFile } = await import("@/lib/actions/pricing-files")
    await expect(deletePricingFile("pricing-x")).rejects.toThrow(
      "Pricing row not found",
    )
    expect(pricingDeleteMock).not.toHaveBeenCalled()
  })

  it("cleans up related ContractPricing rows and logs audit", async () => {
    const row: Row = {
      id: "pricing-1",
      vendorId: "vendor-1",
      vendorItemNo: "SKU-42",
    }
    pricingFindFirstMock.mockResolvedValueOnce(row)
    contractPricingDeleteManyMock.mockResolvedValueOnce({ count: 2 })
    pricingDeleteMock.mockResolvedValueOnce(row)

    const { deletePricingFile } = await import("@/lib/actions/pricing-files")
    const result = await deletePricingFile("pricing-1")

    expect(result).toEqual({ id: "pricing-1" })
    expect(pricingFindFirstMock).toHaveBeenCalledWith({
      where: { id: "pricing-1", facilityId: "fac-1" },
      select: { id: true, vendorId: true, vendorItemNo: true },
    })
    expect(contractPricingDeleteManyMock).toHaveBeenCalledWith({
      where: {
        contract: { facilityId: "fac-1" },
        vendorItemNo: "SKU-42",
      },
    })
    expect(pricingDeleteMock).toHaveBeenCalledWith({
      where: { id: "pricing-1", facilityId: "fac-1" },
    })
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pricing.deleted",
        entityId: "pricing-1",
      }),
    )
  })
})

describe("deletePricingFilesByVendor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects a mismatched facilityId", async () => {
    const { deletePricingFilesByVendor } = await import(
      "@/lib/actions/pricing-files"
    )
    await expect(
      deletePricingFilesByVendor("vendor-1", "fac-2"),
    ).rejects.toThrow("Facility mismatch")
    expect(pricingDeleteManyMock).not.toHaveBeenCalled()
  })

  it("deletes related contract-pricing rows, pricing rows, and audits", async () => {
    pricingFindManyMock.mockResolvedValueOnce([
      { vendorItemNo: "A" },
      { vendorItemNo: "B" },
    ])
    contractPricingDeleteManyMock.mockResolvedValueOnce({ count: 1 })
    pricingDeleteManyMock.mockResolvedValueOnce({ count: 5 })

    const { deletePricingFilesByVendor } = await import(
      "@/lib/actions/pricing-files"
    )
    const result = await deletePricingFilesByVendor("vendor-1", "fac-1")

    expect(result).toEqual({ deleted: 5 })
    expect(contractPricingDeleteManyMock).toHaveBeenCalledWith({
      where: {
        contract: { facilityId: "fac-1" },
        vendorItemNo: { in: ["A", "B"] },
      },
    })
    expect(pricingDeleteManyMock).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", facilityId: "fac-1" },
    })
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pricing.deleted_by_vendor",
        metadata: expect.objectContaining({
          vendorId: "vendor-1",
          deleted: 5,
        }),
      }),
    )
  })
})
