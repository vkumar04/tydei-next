/**
 * fix-inflated-tier-rebates — one-off cleanup for Charles R5.25.
 *
 * Every `ContractTier.rebateValue` in the DB is supposed to be a
 * FRACTION for percent-of-spend tiers (0.02 = 2%). The contract form
 * historically saved raw user input, so a user typing "3" in the
 * "Rebate Value" field persisted 3.0 — which the rebate engine then
 * interpreted as 300%.
 *
 * This script:
 *   1. Finds every `ContractTier` row with `rebateType = 'percent_of_spend'`
 *      and `rebateValue > 1` (the inflated ones).
 *   2. Divides `rebateValue` by 100 in-place.
 *   3. Regenerates auto-accrual Rebate rows for every affected contract
 *      so the ledger reflects the corrected fractions.
 *
 * Safe to run repeatedly — a second run finds nothing to fix because
 * values are now ≤ 1.
 *
 * Usage: `bunx tsx scripts/fix-inflated-tier-rebates.ts`
 */
import { prisma } from "@/lib/db"

const AUTO_ACCRUAL_PREFIX = "[auto-accrual]"

async function main() {
  const before = await prisma.contractTier.findMany({
    where: {
      rebateType: "percent_of_spend",
      rebateValue: { gt: 1 },
    },
    select: {
      id: true,
      rebateValue: true,
      term: { select: { contractId: true } },
    },
  })

  console.log(
    `[fix-inflated-tier-rebates] found ${before.length} inflated ContractTier rows`,
  )

  if (before.length === 0) {
    console.log("[fix-inflated-tier-rebates] nothing to fix, exiting clean")
    return
  }

  const affectedContractIds = new Set<string>()
  let fixed = 0

  for (const row of before) {
    const oldValue = Number(row.rebateValue)
    const newValue = oldValue / 100
    await prisma.contractTier.update({
      where: { id: row.id },
      data: { rebateValue: newValue },
    })
    affectedContractIds.add(row.term.contractId)
    fixed++
  }

  console.log(
    `[fix-inflated-tier-rebates] updated ${fixed} tier rows across ${affectedContractIds.size} contracts`,
  )

  // Purge auto-accrual Rebate rows for every affected contract so the
  // ledger regenerates from the corrected fractions. The next term
  // save (or any explicit recompute trigger) refills these; in the
  // meantime the contract detail card will show $0 earned for
  // affected contracts, which is accurate "needs recompute" state
  // rather than the 100× inflated values users saw before.
  const deleted = await prisma.rebate.deleteMany({
    where: {
      contractId: { in: Array.from(affectedContractIds) },
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
  })
  console.log(
    `[fix-inflated-tier-rebates] deleted ${deleted.count} stale [auto-accrual] Rebate rows`,
  )

  // Verify post-state
  const remaining = await prisma.contractTier.count({
    where: {
      rebateType: "percent_of_spend",
      rebateValue: { gt: 1 },
    },
  })
  console.log(
    `[fix-inflated-tier-rebates] post-run: ${remaining} inflated rows remain (should be 0)`,
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
