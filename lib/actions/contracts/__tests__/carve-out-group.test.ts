/**
 * Regression — Bug 3 (Vick 2026-06-02): "for the carve out something still
 * wrong" on a grouped tie-in contract. `getCarveOutRebate` scoped its COG
 * scan to the primary vendor only, while the accrual writer
 * (recompute/carve-out.ts) counts the full group — so the on-the-fly read
 * disagreed with the persisted Rebate rows. The read must use the canonical
 * contractVendorIds() set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const FACILITY_ID = "f_lighthouse"
const MAIN_VENDOR = "v_main"
const GROUP_VENDOR = "v_group"

const groupedContract = {
  id: "c_group",
  vendorId: MAIN_VENDOR,
  additionalVendorIds: [GROUP_VENDOR],
}

let cogWhere: Record<string, unknown> | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirstOrThrow: vi.fn(async () => groupedContract),
    },
    contractPricing: {
      findMany: vi.fn(async () => [
        { vendorItemNo: "SKU-1", carveOutPercent: 0.12 },
      ]),
    },
    cOGRecord: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        cogWhere = args.where
        return []
      }),
    },
  },
}))

vi.mock("@/lib/serialize", () => ({ serialize: <T>(v: T) => v }))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: FACILITY_ID },
    user: { id: "u1" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  cogWhere = null
})
afterEach(() => vi.resetModules())

describe("carve-out read group scope (Bug 3)", () => {
  it("scopes the COG scan to ALL group vendors, not just the primary", async () => {
    const { getCarveOutRebate } = await import(
      "@/lib/actions/contracts/carve-out"
    )
    await getCarveOutRebate("c_group")

    expect(cogWhere).not.toBeNull()
    const or = cogWhere!.OR as Array<Record<string, unknown>>
    const unenriched = or.find(
      (b) => b.contractId === null && b.vendorId != null,
    )
    expect(unenriched).toBeDefined()
    const vendorClause = unenriched!.vendorId as { in?: string[] }
    expect(vendorClause.in).toEqual([MAIN_VENDOR, GROUP_VENDOR])
  })
})
