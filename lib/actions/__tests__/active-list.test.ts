import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn().mockResolvedValue([
        { id: "c1", name: "Stryker", contractType: "usage", status: "active" },
        { id: "c2", name: "Med", contractType: "capital", status: "active" },
      ]),
      count: vi.fn().mockResolvedValue(2),
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getContracts } from "@/lib/actions/contracts"

describe("getContracts (no type filter)", () => {
  it("returns active contracts of all types", async () => {
    const r = await getContracts({ status: "active" })
    expect(r.contracts).toHaveLength(2)
    expect(r.contracts.map((c) => c.contractType).sort()).toEqual([
      "capital",
      "usage",
    ])
  })
})
