// scripts/oracles/source/_shared/__tests__/cleanup.test.ts
import { describe, it, expect, vi } from "vitest"

const { deleteMany } = vi.hoisted(() => ({
  deleteMany: vi.fn(async () => ({ count: 0 })),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { deleteMany },
    cOGRecord: { deleteMany },
  },
}))

import { wipeScenarioData } from "../cleanup"

describe("wipeScenarioData", () => {
  it("deletes by [ORACLE-<name>] contractNumber prefix", async () => {
    await wipeScenarioData("synthetic-spend-rebate")
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractNumber: { startsWith: "[ORACLE-synthetic-spend-rebate]" },
        }),
      }),
    )
  })

  it("also wipes COG rows tagged with the same notes prefix", async () => {
    await wipeScenarioData("synthetic-spend-rebate")
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          notes: { startsWith: "[ORACLE-synthetic-spend-rebate]" },
        }),
      }),
    )
  })
})
