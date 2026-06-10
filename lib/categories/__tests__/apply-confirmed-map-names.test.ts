/**
 * Charles 2026-06-10 ("still showing categories I mapped away — on the price
 * file this one says Joints Ortho, in mapping I made it Ortho Joints but here
 * it shows Joints ortho"): read-time mapping of display names. Stored
 * ContractTerm.categories / ProductCategory references can predate a
 * confirmed mapping; every surface that renders category names must pass
 * them through applyConfirmedCategoryMapToNames so a superseded name can
 * never be displayed.
 */
import { describe, it, expect } from "vitest"
import { applyConfirmedCategoryMapToNames } from "@/lib/categories/resolve"

const map = new Map<string, string>([
  ["joints ortho", "Ortho Joints"],
  ["extremities & trauma", "Ortho-Extremity"],
])

describe("applyConfirmedCategoryMapToNames", () => {
  it("maps superseded names to their confirmed target", () => {
    expect(applyConfirmedCategoryMapToNames(["Joints Ortho"], map)).toEqual([
      "Ortho Joints",
    ])
  })

  it("is whitespace/case-insensitive on the lookup key", () => {
    expect(
      applyConfirmedCategoryMapToNames(["  joints   ORTHO "], map),
    ).toEqual(["Ortho Joints"])
  })

  it("passes through unmapped names unchanged", () => {
    expect(applyConfirmedCategoryMapToNames(["Spine"], map)).toEqual(["Spine"])
  })

  it("dedupes when a stale name maps onto an already-present target", () => {
    expect(
      applyConfirmedCategoryMapToNames(
        ["Ortho Joints", "Joints Ortho", "Spine"],
        map,
      ),
    ).toEqual(["Ortho Joints", "Spine"])
  })

  it("dedupes two stale names mapping to the same target", () => {
    expect(
      applyConfirmedCategoryMapToNames(
        ["Joints Ortho", "Extremities & Trauma", "Joints Ortho"],
        map,
      ),
    ).toEqual(["Ortho Joints", "Ortho-Extremity"])
  })

  it("returns [] for [] and keeps order of first occurrence", () => {
    expect(applyConfirmedCategoryMapToNames([], map)).toEqual([])
    expect(
      applyConfirmedCategoryMapToNames(["B", "A", "Joints Ortho"], map),
    ).toEqual(["B", "A", "Ortho Joints"])
  })
})
