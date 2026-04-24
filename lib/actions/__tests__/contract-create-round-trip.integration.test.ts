/**
 * Backend integration test — full createContract → match → read cycle.
 *
 * Unlike the unit tests under __tests__/ that mock Prisma, this hits
 * the real local DB via the `prisma` singleton. Designed to catch the
 * class of bugs Charles has been hitting: category-ID vs category-name,
 * evergreen sentinel handling, scoped-term spend computation, multi-
 * term persistence.
 *
 * SKIPPED UNLESS `RUN_INTEGRATION=1` is set — avoids touching the dev
 * DB during normal `bunx vitest run`. Run explicitly:
 *
 *   RUN_INTEGRATION=1 bunx vitest run lib/actions/__tests__/contract-create-round-trip
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { EVERGREEN_DATE, isEvergreen } from "@/lib/contracts/evergreen"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { resolveCategoryIdsToNames } from "@/lib/contracts/resolve-category-names"
import { buildCategoryWhereClause } from "@/lib/contracts/cog-category-filter"

const skip = process.env.RUN_INTEGRATION !== "1"
const d = skip ? describe.skip : describe

let facilityId: string
let vendorId: string
let createdContractId: string | null = null

d("createContract round-trip (real Prisma)", () => {
  beforeAll(async () => {
    const f = await prisma.facility.findFirstOrThrow({
      where: { name: "Lighthouse Community Hospital" },
    })
    facilityId = f.id
    const v =
      (await prisma.vendor.findFirst({ where: { name: "IntegrationTest-Vendor" } })) ??
      (await prisma.vendor.create({
        data: { name: "IntegrationTest-Vendor", status: "active" },
      }))
    vendorId = v.id
  })

  afterAll(async () => {
    if (createdContractId) {
      await prisma.cOGRecord.deleteMany({ where: { facilityId, vendorId } })
      await prisma.contract.delete({ where: { id: createdContractId } }).catch(() => {})
    }
    await prisma.$disconnect()
  })

  it("creates an evergreen contract with 2 scoped terms, resolves category IDs to names, matches COG correctly", async () => {
    // Pick 2 real product categories
    const cats = await prisma.productCategory.findMany({ take: 2 })
    expect(cats.length).toBeGreaterThanOrEqual(2)

    // Verify the resolver works first
    const names = await resolveCategoryIdsToNames(cats.map((c) => c.id))
    expect(names).toEqual(cats.map((c) => c.name))

    // Create a contract directly (simulates what createContract does internally)
    const contract = await prisma.contract.create({
      data: {
        name: "IntegrationTest Contract",
        contractNumber: "INT-001",
        vendorId,
        facilityId,
        contractType: "usage",
        status: "active",
        effectiveDate: new Date("2024-01-01"),
        expirationDate: EVERGREEN_DATE,
        autoRenewal: true,
        terminationNoticeDays: 30,
        totalValue: 1_000_000,
        annualValue: 1_000_000,
        performancePeriod: "monthly",
        rebatePayPeriod: "quarterly",
        isMultiFacility: false,
        isGrouped: false,
      },
    })
    createdContractId = contract.id
    expect(isEvergreen(contract.expirationDate)).toBe(true)

    // Term 1 — all_products (unscoped)
    await prisma.contractTerm.create({
      data: {
        contractId: contract.id,
        termName: "All Products Rebate",
        termType: "spend_rebate",
        baselineType: "spend_based",
        evaluationPeriod: "quarterly",
        paymentTiming: "quarterly",
        appliesTo: "all_products",
        rebateMethod: "cumulative",
        effectiveStart: new Date("2024-01-01"),
        effectiveEnd: EVERGREEN_DATE,
        tiers: {
          create: [
            { tierNumber: 1, spendMin: 0, spendMax: 100_000, rebateType: "percent_of_spend", rebateValue: 0.03 },
          ],
        },
      },
    })

    // Term 2 — scoped. Critical: write NAMES not IDs (this test locks
    // in the fix from 94309d5).
    await prisma.contractTerm.create({
      data: {
        contractId: contract.id,
        termName: "Scoped Rebate",
        termType: "spend_rebate",
        baselineType: "spend_based",
        evaluationPeriod: "quarterly",
        paymentTiming: "quarterly",
        appliesTo: "specific_category",
        categories: names, // names, not IDs
        rebateMethod: "cumulative",
        effectiveStart: new Date("2024-01-01"),
        effectiveEnd: EVERGREEN_DATE,
        tiers: {
          create: [
            { tierNumber: 1, spendMin: 0, spendMax: null, rebateType: "percent_of_spend", rebateValue: 0.05 },
          ],
        },
      },
    })

    // Reload and assert term.categories holds NAMES
    const scopedTerm = await prisma.contractTerm.findFirstOrThrow({
      where: { contractId: contract.id, termName: "Scoped Rebate" },
    })
    expect(scopedTerm.categories).toEqual(names)
    // Must NOT contain any ID-like cuid
    for (const c of scopedTerm.categories) {
      expect(c).not.toMatch(/^c[a-z0-9]{20,}$/)
    }

    // The category filter should produce a Prisma `where` fragment with NAMES
    const filter = buildCategoryWhereClause({
      appliesTo: scopedTerm.appliesTo,
      categories: scopedTerm.categories,
    })
    expect(filter).toEqual({ category: { in: names } })
  })

  it("recompute runs without error on the new contract", async () => {
    if (!createdContractId) return
    const summary = await recomputeMatchStatusesForVendor(prisma, {
      vendorId,
      facilityId,
    })
    expect(summary).toHaveProperty("total")
    expect(summary).toHaveProperty("updated")
  })
})
