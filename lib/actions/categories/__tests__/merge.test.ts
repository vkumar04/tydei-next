import { beforeEach, describe, expect, it, vi } from "vitest"

let cogRows: Array<{ id: string; facilityId: string; category: string | null }> = []
let pricingRows: Array<{ id: string; category: string | null; contract: { facilityId: string } }> = []
let pricingFileRows: Array<{ id: string; facilityId: string; category: string | null }> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) => {
      const tx = {
        cOGRecord: {
          updateMany: async ({
            where,
            data,
          }: {
            where: { facilityId: string; category: { in: string[] } }
            data: { category: string }
          }) => {
            let count = 0
            for (const r of cogRows) {
              if (
                r.facilityId === where.facilityId &&
                r.category &&
                where.category.in.includes(r.category)
              ) {
                r.category = data.category
                count++
              }
            }
            return { count }
          },
        },
        contractPricing: {
          updateMany: async ({
            where,
            data,
          }: {
            where: {
              contract: { facilityId: string }
              category: { in: string[] }
            }
            data: { category: string }
          }) => {
            let count = 0
            for (const r of pricingRows) {
              if (
                r.contract.facilityId === where.contract.facilityId &&
                r.category &&
                where.category.in.includes(r.category)
              ) {
                r.category = data.category
                count++
              }
            }
            return { count }
          },
        },
        pricingFile: {
          updateMany: async ({
            where,
            data,
          }: {
            where: { facilityId: string; category: { in: string[] } }
            data: { category: string }
          }) => {
            let count = 0
            for (const r of pricingFileRows) {
              if (
                r.facilityId === where.facilityId &&
                r.category &&
                where.category.in.includes(r.category)
              ) {
                r.category = data.category
                count++
              }
            }
            return { count }
          },
        },
      }
      return cb(tx)
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1", name: "Test" },
  })),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

describe("mergeCategories", () => {
  beforeEach(() => {
    cogRows = [
      { id: "1", facilityId: "fac-1", category: "Total joint" },
      { id: "2", facilityId: "fac-1", category: "Total joint" },
      { id: "3", facilityId: "fac-1", category: "joints total" },
      { id: "4", facilityId: "fac-1", category: "Spine" },
    ]
    pricingRows = [
      { id: "1", category: "Total joint", contract: { facilityId: "fac-1" } },
      { id: "2", category: "joints total", contract: { facilityId: "fac-1" } },
    ]
    pricingFileRows = [
      { id: "1", facilityId: "fac-1", category: "joints total" },
    ]
  })

  it("renames aliased rows to the canonical name", async () => {
    const { mergeCategories } = await import("@/lib/actions/categories/merge")
    const result = await mergeCategories({
      canonicalName: "Total Joint",
      aliasNames: ["Total joint", "joints total"],
    })

    expect(result.canonicalName).toBe("Total Joint")
    expect(result.cogRowsUpdated).toBe(3)
    expect(result.pricingRowsUpdated).toBe(2)
    expect(result.pricingFileRowsUpdated).toBe(1)
    expect(result.aliasesMerged).toEqual(["Total joint", "joints total"])

    expect(cogRows.filter((r) => r.category === "Total Joint")).toHaveLength(3)
    expect(cogRows.filter((r) => r.category === "Total joint")).toHaveLength(0)
    expect(cogRows.filter((r) => r.category === "joints total")).toHaveLength(0)
    expect(cogRows.filter((r) => r.category === "Spine")).toHaveLength(1)
  })

  it("is idempotent", async () => {
    const { mergeCategories } = await import("@/lib/actions/categories/merge")
    await mergeCategories({
      canonicalName: "Total Joint",
      aliasNames: ["Total joint", "joints total"],
    })
    const second = await mergeCategories({
      canonicalName: "Total Joint",
      aliasNames: ["Total joint", "joints total"],
    })
    expect(second.cogRowsUpdated).toBe(0)
    expect(second.pricingRowsUpdated).toBe(0)
    expect(second.pricingFileRowsUpdated).toBe(0)
  })

  it("rejects an empty canonicalName", async () => {
    const { mergeCategories } = await import("@/lib/actions/categories/merge")
    await expect(
      mergeCategories({ canonicalName: "   ", aliasNames: ["x"] }),
    ).rejects.toThrow(/canonicalName cannot be empty/)
  })
})
