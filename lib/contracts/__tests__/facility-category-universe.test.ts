import { describe, it, expect, vi, beforeEach } from "vitest"

const { cogGroupByMock, mappingFindManyMock } = vi.hoisted(() => ({
  cogGroupByMock: vi.fn(),
  mappingFindManyMock: vi.fn(),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: { groupBy: cogGroupByMock },
    categoryMapping: { findMany: mappingFindManyMock },
  },
}))
import { facilityChosenCategoryNames } from "@/lib/contracts/facility-category-universe"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("facilityChosenCategoryNames (bugs.rtfd 2026-06-13)", () => {
  it("unions COG-spend categories with confirmed mapping targets", async () => {
    cogGroupByMock.mockResolvedValue([
      { category: "Ortho-Sports Med" },
      { category: "Ortho-Joints" },
      { category: null },
    ])
    mappingFindManyMock.mockResolvedValue([
      { contractCategory: "Spine" }, // chosen target with no direct COG spend
      { contractCategory: "Ortho-Joints" }, // dup of a COG category
    ])
    const result = await facilityChosenCategoryNames("fac-1")
    expect([...result].sort()).toEqual([
      "Ortho-Joints",
      "Ortho-Sports Med",
      "Spine",
    ])
  })

  it("degrades to COG-only when the mapping query fails", async () => {
    cogGroupByMock.mockResolvedValue([{ category: "Ortho-Extremity" }])
    mappingFindManyMock.mockRejectedValue(new Error("db down"))
    const result = await facilityChosenCategoryNames("fac-1")
    expect(result).toEqual(["Ortho-Extremity"])
  })
})
