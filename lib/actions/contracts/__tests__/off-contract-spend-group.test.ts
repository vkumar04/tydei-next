/**
 * Regression — Bug 11/12 (Vick 2026-06-02): "for group contract it is not
 * counting the other groups it is only counting the main vendor" and "if
 * On contract is only 500K how can contract total be 7.8M?"
 *
 * `getOffContractSpend` (the "On vs Off Contract Spend" card) scoped
 * un-enriched rows to contract.vendorId alone, so a grouped contract's
 * On-Contract total dropped every additional vendor's spend. The scope
 * must use the full contractVendorIds() set.
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

// Capture the where clauses passed to aggregate so we can assert scope.
const aggregateCalls: Array<Record<string, unknown>> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: vi.fn(async () => groupedContract),
    },
    cOGRecord: {
      aggregate: vi.fn(async (args: { where: Record<string, unknown> }) => {
        aggregateCalls.push(args.where)
        return { _sum: { extendedPrice: 0 } }
      }),
      groupBy: vi.fn(async () => []),
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
  aggregateCalls.length = 0
})
afterEach(() => vi.resetModules())

describe("off-contract spend group scope (Bug 11/12)", () => {
  it("scopes un-enriched rows to ALL group vendors, not just the primary", async () => {
    const { getOffContractSpend } = await import(
      "@/lib/actions/contracts/off-contract-spend"
    )
    await getOffContractSpend("c_group")

    expect(aggregateCalls.length).toBeGreaterThan(0)
    for (const where of aggregateCalls) {
      const or = where.OR as Array<Record<string, unknown>>
      expect(or).toBeDefined()
      // The un-enriched branch must scope vendorId via `in` over the full
      // group set — main + additional — rather than the bare primary id.
      const unenriched = or.find(
        (b) => b.contractId === null && b.vendorId != null,
      )
      expect(unenriched).toBeDefined()
      const vendorClause = unenriched!.vendorId as { in?: string[] }
      expect(vendorClause.in).toEqual([MAIN_VENDOR, GROUP_VENDOR])
    }
  })
})
