/**
 * Division category-scope semantics (bug-bash follow-up 2026-07-02): the
 * isolation key for category-carrying rows without a `vendorDivisionId`
 * column (facility COGRecord, ProductBenchmark). Locks the
 * undefined/[]/no-categories/with-categories contract and the canonical
 * (case/word-order/plural-insensitive) matching.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { divisionFindMany } = vi.hoisted(() => ({ divisionFindMany: vi.fn() }))

vi.mock("@/lib/db", () => ({
  prisma: { vendorDivision: { findMany: divisionFindMany } },
}))

import {
  divisionCategoryKeySet,
  categoryInDivisionScope,
} from "@/lib/divisions/category-scope"

beforeEach(() => {
  vi.clearAllMocks()
  divisionFindMany.mockResolvedValue([])
})

describe("divisionCategoryKeySet", () => {
  it("undefined divisionIds → null (enterprise, unrestricted)", async () => {
    expect(await divisionCategoryKeySet(undefined)).toBeNull()
    expect(divisionFindMany).not.toHaveBeenCalled()
  })

  it("empty divisionIds → empty Set (sees nothing)", async () => {
    const keys = await divisionCategoryKeySet([])
    expect(keys).toBeInstanceOf(Set)
    expect(keys!.size).toBe(0)
    expect(divisionFindMany).not.toHaveBeenCalled()
  })

  it("divisions with NO categories → null (nothing to isolate by)", async () => {
    divisionFindMany.mockResolvedValueOnce([{ categories: [] }])
    expect(await divisionCategoryKeySet(["d-1"])).toBeNull()
  })

  it("divisions with categories → canonical key set", async () => {
    divisionFindMany.mockResolvedValueOnce([
      { categories: ["Joint Replacement"] },
      { categories: ["Sports Medicine", "Trauma"] },
    ])
    const keys = await divisionCategoryKeySet(["d-1", "d-2"])
    expect(keys).not.toBeNull()
    // Canonical matching: case + plural variants of a declared category hit.
    expect(categoryInDivisionScope("joint replacements", keys)).toBe(true)
    expect(categoryInDivisionScope("Trauma", keys)).toBe(true)
    expect(categoryInDivisionScope("Cardiology", keys)).toBe(false)
  })
})

describe("categoryInDivisionScope", () => {
  it("null keys → everything in scope", () => {
    expect(categoryInDivisionScope("Anything", null)).toBe(true)
    expect(categoryInDivisionScope(null, null)).toBe(true)
  })

  it("restricted → uncategorized rows are OUT of scope", () => {
    const keys = new Set(["trauma"])
    expect(categoryInDivisionScope(null, keys)).toBe(false)
    expect(categoryInDivisionScope("", keys)).toBe(false)
  })

  it("empty Set (no divisions) matches nothing", () => {
    expect(categoryInDivisionScope("Trauma", new Set())).toBe(false)
  })
})
