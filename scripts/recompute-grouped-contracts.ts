/**
 * One-time reconcile pass for #2 (Vick 2026-05-31).
 *
 * Grouped contracts (`additionalVendorIds` non-empty) had their rebate
 * accruals computed from PRIMARY-vendor spend only. After the group-aware
 * change, re-run the accrual engine over every grouped contract so the
 * persisted Rebate rows reflect the whole group's spend.
 *
 * Idempotent: recompute deletes + re-inserts the auto-accrual rows each
 * run. Persisted metric fields (complianceRate / currentMarketShare /
 * annualValue) refresh on the next COG import — refreshContractMetricsForVendor
 * is now group-aware — or via the contract-detail "Recompute" button.
 *
 *   bun run scripts/recompute-grouped-contracts.ts
 */
import { prisma } from "@/lib/db"
import { _recomputeAccrualForContractWithFacility } from "@/lib/actions/contracts/recompute-accrual"

async function main() {
  const grouped = await prisma.contract.findMany({
    where: { additionalVendorIds: { isEmpty: false } },
    select: {
      id: true,
      name: true,
      facilityId: true,
      additionalVendorIds: true,
    },
  })

  console.log(`Found ${grouped.length} grouped contract(s) to reconcile.\n`)
  let ok = 0
  let failed = 0
  for (const c of grouped) {
    try {
      const r = await _recomputeAccrualForContractWithFacility(c.id, c.facilityId)
      console.log(
        `✓ ${c.name} (${c.additionalVendorIds.length + 1} vendors): ` +
          `-${r.deleted}/+${r.inserted} rebate rows, earned=${r.sumEarned}`,
      )
      ok++
    } catch (e) {
      console.error(`✗ ${c.name}:`, e instanceof Error ? e.message : e)
      failed++
    }
  }
  console.log(`\nDone. ${ok} recomputed, ${failed} failed.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
