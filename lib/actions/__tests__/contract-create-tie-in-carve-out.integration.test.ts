/**
 * Integration test for the Bugs.rtfd 2026-05-25 Mako tie-in carve-out
 * create failure. Drives the REAL createContract action against the
 * REAL local Prisma DB with the exact payload shape that 500'd in prod
 * (negative spendMax inside the embedded Carve Out term).
 *
 * Skipped unless RUN_INTEGRATION=1 — same convention as the other
 * .integration.test.ts files. Run:
 *
 *   RUN_INTEGRATION=1 bunx vitest run \
 *     lib/actions/__tests__/contract-create-tie-in-carve-out
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { prisma } from "@/lib/db"

let facilityId: string
let userId: string
let vendorId: string
const created: string[] = []

const skip = process.env.RUN_INTEGRATION !== "1"
const d = skip ? describe.skip : describe

vi.mock("@/lib/actions/auth", async () => {
  // Resolved lazily so the IDs picked in beforeAll land in the mock.
  return {
    requireFacility: vi.fn(async () => ({
      facility: { id: facilityId, name: "Lighthouse Surgical Center" },
      user: { id: userId, name: "Test", email: "test@example.com" },
    })),
    requireVendor: vi.fn(),
    requireAdmin: vi.fn(),
  }
})

// next/cache helpers require a real request context — fake them for
// this script-driven integration test so the post-write revalidate
// calls don't crash the action.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: <T,>(fn: T): T => fn,
}))

// Import AFTER the mock so createContract picks it up.
const { createContract } = await import("@/lib/actions/contracts/create")

d("createContract — Mako tie-in carve-out (Bugs.rtfd 2026-05-25)", () => {
  beforeAll(async () => {
    const fac = await prisma.facility.findFirstOrThrow({
      where: { name: "Lighthouse Surgical Center" },
    })
    facilityId = fac.id
    const u = await prisma.user.findFirstOrThrow({
      where: { email: "demo-facility@tydei.com" },
    })
    userId = u.id
    const v = await prisma.vendor.findFirstOrThrow({
      where: { name: "Stryker" },
    })
    vendorId = v.id
  })

  afterAll(async () => {
    for (const id of created) {
      // No onDelete: Cascade on term→contract in the schema, so delete
      // tiers + terms first to avoid FK violation on contract.delete.
      await prisma.contractTier
        .deleteMany({ where: { term: { contractId: id } } })
        .catch(() => {})
      await prisma.contractTerm
        .deleteMany({ where: { contractId: id } })
        .catch(() => {})
      await prisma.contract.delete({ where: { id } }).catch(() => {})
    }
    await prisma.$disconnect()
  })

  it("creates a tie-in contract with a Carve Out term whose tier has spendMax=-1 (AI-extracted 'uncapped' sentinel)", async () => {
    const result = await createContract({
      name: `TEST Mako Tie-In Carve-Out ${Date.now()}`,
      vendorId,
      facilityId,
      categoryIds: [],
      contractType: "tie_in",
      status: "active",
      effectiveDate: "2023-12-22",
      expirationDate: "2028-10-17",
      autoRenewal: false,
      terminationNoticeDays: 90,
      totalValue: 865_384,
      annualValue: 176_010,
      performancePeriod: "annual",
      rebatePayPeriod: "annual",
      isMultiFacility: false,
      facilityIds: [],
      terms: [
        {
          termName: "Refurbished Mako System (6 Annual Installments)",
          termType: "carve_out",
          baselineType: "spend_based",
          evaluationPeriod: "annual",
          paymentTiming: "quarterly",
          appliesTo: "all_products",
          rebateMethod: "cumulative",
          effectiveStart: "2023-12-22",
          effectiveEnd: "2028-10-17",
          tiers: [
            {
              tierNumber: 1,
              spendMin: 0,
              spendMax: -1, // AI-extracted "no upper bound" sentinel — was 500ing
              rebateType: "percent_of_spend",
              rebateValue: 0,
            },
          ],
        },
      ],
    })

    expect(result).toBeDefined()
    expect(result).toHaveProperty("id")
    if (result && typeof result === "object" && "id" in result) {
      created.push(result.id as string)
    }

    // Verify the term + tier landed correctly; the negative spendMax
    // should be NULL in the DB (coerced from -1 → undefined by the
    // validator, then to NULL by the Prisma write).
    const id = (result as { id: string }).id
    const persisted = await prisma.contract.findUniqueOrThrow({
      where: { id },
      include: { terms: { include: { tiers: true } } },
    })
    expect(persisted.terms).toHaveLength(1)
    expect(persisted.terms[0]?.termType).toBe("carve_out")
    expect(persisted.terms[0]?.tiers).toHaveLength(1)
    expect(persisted.terms[0]?.tiers[0]?.spendMax).toBeNull()
  })
})
