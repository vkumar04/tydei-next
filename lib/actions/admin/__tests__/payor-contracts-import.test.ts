import { describe, it, expect, vi, beforeEach } from "vitest"

// Captured state for the mocked PayorContract row + the update payload.
let storedCptRates: unknown[] = []
let lastUpdateData: { cptRates?: unknown } | null = null

const payorContractFindUniqueOrThrow = vi.fn(async () => ({
  id: "pc-1",
  cptRates: storedCptRates,
}))
const payorContractUpdate = vi.fn(
  async (args: { where: { id: string }; data: { cptRates?: unknown } }) => {
    lastUpdateData = args.data
    return { id: args.where.id, ...args.data }
  },
)

vi.mock("@/lib/db", () => ({
  prisma: {
    payorContract: {
      findUniqueOrThrow: () => payorContractFindUniqueOrThrow(),
      update: (args: { where: { id: string }; data: { cptRates?: unknown } }) =>
        payorContractUpdate(args),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireAdmin: vi.fn(async () => ({ user: { id: "admin-1" } })),
}))

import { importCPTRates } from "@/lib/actions/admin/payor-contracts"

describe("importCPTRates input validation (best-practices sweep)", () => {
  beforeEach(() => {
    storedCptRates = []
    lastUpdateData = null
    payorContractUpdate.mockClear()
  })

  it("drops a malformed row (missing cpt/cptCode) and persists only valid rows", async () => {
    const result = await importCPTRates("pc-1", [
      { cptCode: "29881", rate: 1200, description: "Knee scope" },
      // malformed: no cpt/cptCode at all
      { rate: 999 } as never,
    ])

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    const persisted = (lastUpdateData?.cptRates ?? []) as Array<{
      cptCode?: string
      cpt?: string
    }>
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.cptCode).toBe("29881")
  })

  it("drops a row with a non-finite / non-number rate", async () => {
    const result = await importCPTRates("pc-1", [
      { cptCode: "29881", rate: 1200 },
      { cptCode: "27447", rate: Number.NaN } as never,
      { cptCode: "27448", rate: "free" } as never,
    ])

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(2)
  })

  it("accepts the legacy {cpt} shape the rate-map also reads", async () => {
    const result = await importCPTRates("pc-1", [
      { cpt: "12345", rate: 500 } as never,
    ])

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it("merges valid new rows onto existing stored rows", async () => {
    storedCptRates = [{ cptCode: "10000", rate: 100 }]
    await importCPTRates("pc-1", [{ cptCode: "20000", rate: 200 }])

    const persisted = (lastUpdateData?.cptRates ?? []) as unknown[]
    expect(persisted).toHaveLength(2)
  })

  it("rejects a non-array payload outright (never writes)", async () => {
    await expect(
      importCPTRates("pc-1", "not-an-array" as never),
    ).rejects.toThrow(/must be an array/)
    expect(payorContractUpdate).not.toHaveBeenCalled()
  })
})
