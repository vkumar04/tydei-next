/**
 * #4 (Vick 2026-05-31): the category resolver must apply confirmed
 * CategoryMapping rules (Pass 0) so mapped category variants unify on
 * every import — the category twin of the vendor resolver's Pass 0 (#1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const categoryMappingFindMany = vi.fn()
const productCategoryFindMany = vi.fn()
const productCategoryCreate = vi.fn()
const productCategoryFindFirst = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    categoryMapping: { findMany: (a: unknown) => categoryMappingFindMany(a) },
    productCategory: {
      findMany: (a: unknown) => productCategoryFindMany(a),
      create: (a: unknown) => productCategoryCreate(a),
      findFirst: (a: unknown) => productCategoryFindFirst(a),
    },
  },
}))

describe("category resolver — confirmed mapping Pass 0", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // "JOINT" is confirmed-mapped to "Ortho-Joints".
    categoryMappingFindMany.mockResolvedValue([
      { cogCategory: "JOINT", contractCategory: "Ortho-Joints" },
    ])
    // ProductCategory has the canonical name but NOT "JOINT".
    productCategoryFindMany.mockResolvedValue([
      { id: "1", name: "Ortho-Joints" },
      { id: "2", name: "Spine" },
    ])
  })

  it("resolveCategoryName maps a variant to its canonical category", async () => {
    const { resolveCategoryName } = await import("@/lib/categories/resolve")
    expect(await resolveCategoryName("JOINT")).toBe("Ortho-Joints")
    // Only confirmed, target-set rules are loaded.
    expect(categoryMappingFindMany).toHaveBeenCalledWith({
      where: { isConfirmed: true, contractCategory: { not: null } },
      select: { cogCategory: true, contractCategory: true },
    })
  })

  it("is case/whitespace-insensitive on the mapped name", async () => {
    const { resolveCategoryName } = await import("@/lib/categories/resolve")
    expect(await resolveCategoryName("  joint ")).toBe("Ortho-Joints")
  })

  it("falls back to the ProductCategory match when no mapping applies", async () => {
    const { resolveCategoryName } = await import("@/lib/categories/resolve")
    expect(await resolveCategoryName("Spine")).toBe("Spine")
  })

  it("bulk: maps mapped names, resolves the rest normally", async () => {
    const { resolveCategoryNamesBulk } = await import("@/lib/categories/resolve")
    const m = await resolveCategoryNamesBulk(["JOINT", "Spine", "joint"])
    expect(m.get("joint")).toBe("Ortho-Joints")
    expect(m.get("spine")).toBe("Spine")
  })
})
