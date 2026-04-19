/**
 * fix-inflated-interest-rates — one-off cleanup for Charles W1.E.
 *
 * Every `ContractTerm.interestRate` in the DB is supposed to be a
 * FRACTION (0.04 = 4% APR), matching the `ContractTier.rebateValue`
 * convention. The tie-in capital entry form historically saved raw
 * user input, so a user typing "4" in the "Interest Rate (%)" field
 * persisted 4.0 — which the amortization engine then interpreted as
 * 400% APR. On a quarterly schedule that produces 100% interest per
 * period (every row's Interest Charge == Opening Balance).
 *
 * This script:
 *   1. Finds every `ContractTerm` with `interestRate > 1` (the
 *      inflated ones).
 *   2. Divides `interestRate` by 100 in-place.
 *   3. Purges `ContractAmortizationSchedule` rows for affected
 *      contracts so the engine recomputes lazily on the next read
 *      (mirrors Wave D's symmetrical-mode "no persisted rows" path).
 *
 * Safe to run repeatedly — a second run finds nothing to fix because
 * values are now ≤ 1.
 *
 * Usage: `bunx tsx scripts/fix-inflated-interest-rates.ts`
 */
import { prisma } from "@/lib/db"

async function main() {
  const before = await prisma.contractTerm.findMany({
    where: {
      interestRate: { gt: 1 },
    },
    select: {
      id: true,
      contractId: true,
      interestRate: true,
    },
  })

  console.log(
    `[fix-inflated-interest-rates] found ${before.length} inflated ContractTerm rows`,
  )

  if (before.length === 0) {
    console.log("[fix-inflated-interest-rates] nothing to fix, exiting clean")
    return
  }

  // Sample one row for the before/after report.
  const sample = before[0]!
  const sampleBefore = Number(sample.interestRate)

  const affectedContractIds = new Set<string>()
  const affectedTermIds = new Set<string>()
  let fixed = 0

  for (const row of before) {
    const oldValue = Number(row.interestRate)
    const newValue = oldValue / 100
    await prisma.contractTerm.update({
      where: { id: row.id },
      data: { interestRate: newValue },
    })
    affectedContractIds.add(row.contractId)
    affectedTermIds.add(row.id)
    fixed++
  }

  console.log(
    `[fix-inflated-interest-rates] updated ${fixed} term rows across ${affectedContractIds.size} contracts`,
  )
  console.log(
    `[fix-inflated-interest-rates] sample row ${sample.id}: ${sampleBefore} → ${sampleBefore / 100}`,
  )

  // Purge persisted ContractAmortizationSchedule rows for affected
  // terms so the engine recomputes on the next read. For symmetrical
  // terms this is the right move — the engine rebuilds live. For
  // custom-shape terms the user-entered amortizationDue amounts are
  // preserved in the source term data (not deleted here); only the
  // Decimal rollups get regenerated at next save.
  const deleted = await prisma.contractAmortizationSchedule.deleteMany({
    where: {
      termId: { in: Array.from(affectedTermIds) },
    },
  })
  console.log(
    `[fix-inflated-interest-rates] deleted ${deleted.count} stale ContractAmortizationSchedule rows`,
  )

  // Verify post-state
  const remaining = await prisma.contractTerm.count({
    where: {
      interestRate: { gt: 1 },
    },
  })
  console.log(
    `[fix-inflated-interest-rates] post-run: ${remaining} inflated rows remain (should be 0)`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
