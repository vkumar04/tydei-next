/**
 * Source-scenario harness. Drives the contract spec + pricing rows +
 * COG rows through the real production pipeline:
 *   1. Resolve facility + vendor (look up by name; create vendor if
 *      missing — facility must already exist).
 *   2. Create the contract with prefixed contractNumber.
 *   3. Insert ContractTerm + ContractTier rows from spec.terms.
 *   4. Insert ContractPricing rows from pricingRows.
 *   5. Insert COG rows tagged with [ORACLE-<name>] in `notes`,
 *      then run `recomputeMatchStatusesForVendor` so they pair with
 *      the contract.
 *   6. Read every customer-facing aggregate via the canonical helpers.
 *   7. In finally: wipeScenarioData() so the demo DB stays clean.
 *
 * NOT tx-rollback because bulkImportCOGRecords + recompute use the
 * global Prisma client (not a tx parameter). Cleanup-by-name is the
 * pragmatic alternative until the importer is refactored.
 */
import { prisma } from "@/lib/db"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { wipeScenarioData } from "./cleanup"
import type { Scenario, ScenarioExpectations } from "./scenario"

export interface ScenarioActuals {
  rebateEarnedLifetime: number
  rebateCollected: number
  currentSpend: number
  rebateRowCount: number
  contractPeriodCount: number
}

export async function runScenario(s: Scenario): Promise<ScenarioActuals> {
  const tag = `[ORACLE-${s.name}]`
  // 1. Idempotent cleanup of any prior leftover.
  await wipeScenarioData(s.name)

  try {
    // 2. Facility lookup (must exist — scenarios use real demo facilities).
    const facility = await prisma.facility.findFirst({
      where: { name: s.facilityName },
      select: { id: true },
    })
    if (!facility) {
      throw new Error(
        `Facility "${s.facilityName}" not found. Scenarios target real seeded facilities; run \`bun run db:seed\` or pick an existing name.`,
      )
    }

    // 3. Vendor: create if missing. We don't tag vendors; cleanup just
    //    removes contracts + COG by prefix and leaves vendors.
    const vendor =
      (await prisma.vendor.findFirst({
        where: { name: s.contract.vendorName },
        select: { id: true },
      })) ??
      (await prisma.vendor.create({
        data: { name: s.contract.vendorName },
        select: { id: true },
      }))

    // 4. Contract.
    const contract = await prisma.contract.create({
      data: {
        contractNumber: `${tag}-${s.contract.contractNumberSuffix}`,
        name: s.contract.name,
        vendorId: vendor.id,
        facilityId: facility.id,
        contractType: s.contract.contractType,
        status: s.contract.status ?? "active",
        effectiveDate: new Date(s.contract.effectiveDate),
        expirationDate: new Date(s.contract.expirationDate),
        totalValue: s.contract.totalValue,
        annualValue: s.contract.annualValue,
      },
      select: { id: true },
    })

    // 5. Terms + tiers.
    for (const t of s.contract.terms) {
      const term = await prisma.contractTerm.create({
        data: {
          contractId: contract.id,
          termName: t.termName,
          termType: t.termType,
          appliesTo: t.appliesTo ?? "all_products",
          evaluationPeriod: t.evaluationPeriod ?? "annual",
          paymentTiming: t.paymentTiming ?? "annual",
          baselineType: t.baselineType ?? "spend_based",
          rebateMethod: t.rebateMethod ?? "cumulative",
          effectiveStart: new Date(s.contract.effectiveDate),
          effectiveEnd: new Date(s.contract.expirationDate),
        },
        select: { id: true },
      })
      if (t.tiers.length > 0) {
        await prisma.contractTier.createMany({
          data: t.tiers.map((tier) => ({
            termId: term.id,
            tierNumber: tier.tierNumber,
            spendMin: tier.spendMin,
            spendMax: tier.spendMax,
            rebateValue: tier.rebateValue,
            rebateType: "percent_of_spend",
          })),
        })
      }
    }

    // 6. Pricing rows. ContractPricing schema: vendorItemNo, unitPrice,
    //    description?, category?. No `manufacturer` column — drop it.
    if (s.pricingRows.length > 0) {
      await prisma.contractPricing.createMany({
        data: s.pricingRows.map((p) => ({
          contractId: contract.id,
          vendorItemNo: p.vendorItemNo,
          unitPrice: p.unitCost,
          category: p.category,
        })),
      })
    }

    // 7. COG rows. Tag every notes with the scenario tag so cleanup
    //    can wipe them.
    if (s.cogRows.length > 0) {
      await prisma.cOGRecord.createMany({
        data: s.cogRows.map((r) => ({
          facilityId: facility.id,
          vendorId: vendor.id,
          vendorName: s.contract.vendorName,
          inventoryNumber: r.inventoryNumber ?? r.vendorItemNo,
          inventoryDescription:
            r.inventoryDescription ?? `Item ${r.vendorItemNo}`,
          vendorItemNo: r.vendorItemNo,
          unitCost: r.unitCost,
          quantity: r.quantity,
          extendedPrice: r.extendedPrice,
          transactionDate: new Date(r.transactionDate),
          category: r.category,
          notes: tag,
        })),
      })
    }

    // 8. Run recompute — pair COG with contract via ContractPricing
    //    matches.
    const { recomputeMatchStatusesForVendor } = await import(
      "@/lib/cog/recompute"
    )
    await recomputeMatchStatusesForVendor(prisma, {
      vendorId: vendor.id,
      facilityId: facility.id,
    })

    // 9. Run accrual recompute so Rebate + ContractPeriod rows are
    //    persisted from the matched COG. Use the auth-bypassing engine
    //    since the harness has no session.
    const { _recomputeAccrualForContractWithFacility } = await import(
      "@/lib/actions/contracts/recompute-accrual"
    )
    await _recomputeAccrualForContractWithFacility(contract.id, facility.id)

    // 10. Read aggregates.
    const rebates = await prisma.rebate.findMany({
      where: { contractId: contract.id },
      select: {
        rebateEarned: true,
        rebateCollected: true,
        payPeriodEnd: true,
        collectionDate: true,
      },
    })
    const periodCount = await prisma.contractPeriod.count({
      where: { contractId: contract.id },
    })
    const cogAgg = await prisma.cOGRecord.aggregate({
      where: { facilityId: facility.id, vendorId: vendor.id, notes: tag },
      _sum: { extendedPrice: true },
    })

    return {
      rebateEarnedLifetime: sumEarnedRebatesLifetime(rebates),
      rebateCollected: sumCollectedRebates(rebates),
      currentSpend: Number(cogAgg._sum.extendedPrice ?? 0),
      rebateRowCount: rebates.length,
      contractPeriodCount: periodCount,
    }
  } finally {
    await wipeScenarioData(s.name)
  }
}

export function checkExpectations(
  actuals: ScenarioActuals,
  expectations: ScenarioExpectations,
): { name: string; pass: boolean; detail: string }[] {
  const results: { name: string; pass: boolean; detail: string }[] = []
  const compare = (
    label: string,
    expected: number | undefined,
    actual: number,
  ) => {
    if (expected == null) return
    results.push({
      name: label,
      pass: Math.abs(actual - expected) < 0.01,
      detail: `expected=${expected} actual=${actual.toFixed(2)}`,
    })
  }
  compare(
    "rebateEarnedLifetime",
    expectations.rebateEarnedLifetime,
    actuals.rebateEarnedLifetime,
  )
  compare(
    "rebateCollected",
    expectations.rebateCollected,
    actuals.rebateCollected,
  )
  compare("currentSpend", expectations.currentSpend, actuals.currentSpend)
  compare(
    "rebateRowCount",
    expectations.rebateRowCount,
    actuals.rebateRowCount,
  )
  compare(
    "contractPeriodCount",
    expectations.contractPeriodCount,
    actuals.contractPeriodCount,
  )
  return results
}
