/**
 * purge-future-accruals — one-off cleanup for Charles W1.Q.
 *
 * Finds and deletes any `Rebate` rows with the `[auto-accrual]` notes
 * prefix and `payPeriodEnd > today`. Such rows are stale artifacts of
 * seed/cleanup scripts (or pre-R5.26 recompute runs) that wrote future-
 * dated accrual rows — the current engine bounds the window by
 * `Math.min(today, expirationDate)`, so no new future-dated
 * `[auto-accrual]` rows will be written.
 *
 * Manual rebate rows (no notes prefix) are preserved, including any
 * manual future-dated entries a user may have recorded deliberately.
 *
 * Idempotent — safe to run repeatedly. Prints the delete count.
 *
 * Usage: `bun --env-file=.env scripts/purge-future-accruals.ts`
 */
import { prisma } from "@/lib/db"

const AUTO_ACCRUAL_PREFIX = "[auto-accrual]"

async function main() {
  const now = new Date()
  const before = await prisma.rebate.count({
    where: {
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
      payPeriodEnd: { gt: now },
    },
  })

  console.log(
    `[purge-future-accruals] found ${before} future-dated [auto-accrual] Rebate rows (payPeriodEnd > ${now.toISOString()})`,
  )

  if (before === 0) {
    console.log("[purge-future-accruals] nothing to purge, exiting clean")
    return
  }

  const deleted = await prisma.rebate.deleteMany({
    where: {
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
      payPeriodEnd: { gt: now },
    },
  })

  console.log(
    `[purge-future-accruals] deleted ${deleted.count} stale future-dated [auto-accrual] Rebate rows`,
  )

  const remaining = await prisma.rebate.count({
    where: {
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
      payPeriodEnd: { gt: new Date() },
    },
  })
  console.log(
    `[purge-future-accruals] post-run: ${remaining} rows remain (should be 0)`,
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
