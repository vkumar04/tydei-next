import { describe, it, expect, vi } from "vitest"

// Mock the prisma client used inside the resolver.
vi.mock("@/lib/db", () => ({
  prisma: {
    productCategory: {
      findMany: vi.fn(),
    },
  },
}))

import { resolveCategoryIdsToNames } from "@/lib/contracts/resolve-category-names"
import { prisma } from "@/lib/db"

describe("resolveCategoryIdsToNames", () => {
  it("returns empty array for null / undefined / empty inputs", async () => {
    expect(await resolveCategoryIdsToNames(null)).toEqual([])
    expect(await resolveCategoryIdsToNames(undefined)).toEqual([])
    expect(await resolveCategoryIdsToNames([])).toEqual([])
  })

  it("resolves IDs to names via ProductCategory lookup", async () => {
    ;(prisma.productCategory.findMany as any).mockResolvedValueOnce([
      { id: "cat-id-1", name: "Ortho-Extremity" },
      { id: "cat-id-2", name: "Sports Med" },
    ])
    const result = await resolveCategoryIdsToNames(["cat-id-1", "cat-id-2"])
    expect(result).toEqual(["Ortho-Extremity", "Sports Med"])
  })

  it("preserves input order even when DB returns results in different order", async () => {
    ;(prisma.productCategory.findMany as any).mockResolvedValueOnce([
      { id: "b", name: "B-name" },
      { id: "a", name: "A-name" },
    ])
    const result = await resolveCategoryIdsToNames(["a", "b"])
    expect(result).toEqual(["A-name", "B-name"])
  })

  it("de-dupes repeated IDs", async () => {
    ;(prisma.productCategory.findMany as any).mockResolvedValueOnce([
      { id: "x", name: "X-name" },
    ])
    const result = await resolveCategoryIdsToNames(["x", "x", "x"])
    expect(result).toEqual(["X-name"])
  })

  it("passes through unchanged when nothing matches (legacy already-names input)", async () => {
    ;(prisma.productCategory.findMany as any).mockResolvedValueOnce([])
    const result = await resolveCategoryIdsToNames(["Ortho-Extremity", "Sports Med"])
    expect(result).toEqual(["Ortho-Extremity", "Sports Med"])
  })

  it("partial-match: unresolved IDs fall through, matched IDs get names", async () => {
    ;(prisma.productCategory.findMany as any).mockResolvedValueOnce([
      { id: "real-id", name: "Real Name" },
    ])
    const result = await resolveCategoryIdsToNames(["real-id", "stale-id"])
    expect(result).toEqual(["Real Name", "stale-id"])
  })
})
