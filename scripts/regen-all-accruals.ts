/**
 * regen-all-accruals — one-off to rebuild every contract's auto-accrual
 * Rebate ledger (Charles R5.26 follow-up).
 *
 * R5.25 divided inflated `percent_of_spend` tier values by 100 and purged
 * `[auto-accrual]` Rebate rows on affected contracts. The intent was for
 * R5.21's save-time recompute to regenerate them on the next term edit,
 * but there was no trigger — so ledgers stayed empty until someone
 * manually touched a term. This script does that regeneration in bulk
 * for every contract in the DB, independent of session scope.
 *
 * For each contract:
 *   1. Skip if its `contractType` doesn't earn rebates (pricing_only —
 *      the R5.6 guard).
 *   2. Skip if it has no terms (nothing to compute against).
 *   3. Re-run the same compute path `recomputeAccrualForContract` uses,
 *      but without requiring a facility session — the caller is the
 *      script, not a user.
 *   4. Delete existing `[auto-accrual]` rows for the contract and insert
 *      freshly-computed ones. Manually-entered Rebate rows (no notes
 *      prefix) are preserved.
 *
 * Idempotent — safe to run repeatedly. Prints per-contract
 * before/after counts and total spend so a human can eyeball the result.
 *
 * Usage: `bun --env-file=.env scripts/regen-all-accruals.ts`
 */
import { prisma } from "@/lib/db"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"
import {
  buildMonthlyAccruals,
  type MonthlySpend,
  type EvaluationPeriod,
} from "@/lib/contracts/accrual"
import type { TierLike, RebateMethodName } from "@/lib/contracts/rebate-method"

const AUTO_ACCRUAL_PREFIX = "[auto-accrual]"

type ContractRow = Awaited<ReturnType<typeof loadContracts>>[number]

async function loadContracts() {
  return prisma.contract.findMany({
    where: { terms: { some: {} } },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })
}

async function regenerateOne(contract: ContractRow) {
  if (!contractTypeEarnsRebates(contract.contractType)) {
    return { skipped: "pricing_only" as const, inserted: 0, deleted: 0 }
  }

  const firstTerm = contract.terms[0]
  if (!firstTerm || firstTerm.tiers.length === 0) {
    return { skipped: "no_term_or_tiers" as const, inserted: 0, deleted: 0 }
  }

  const tiers: TierLike[] = firstTerm.tiers.map((t) => ({
    tierNumber: t.tierNumber,
    spendMin: t.spendMin,
    spendMax: t.spendMax,
    rebateValue: t.rebateValue,
    rebateType: t.rebateType,
  }))

  const method: RebateMethodName = firstTerm.rebateMethod === "marginal"
    ? "marginal"
    : "cumulative"
  const evaluationPeriod =
    (firstTerm.evaluationPeriod as EvaluationPeriod | null) ?? "annual"

  // Bound the accrual window by today so future months don't pollute
  // earned aggregates that filter on payPeriodEnd <= today.
  const today = new Date()
  const end = new Date(
    Math.min(today.getTime(), contract.expirationDate.getTime()),
  )

  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId: contract.facilityId,
      vendorId: contract.vendorId,
      transactionDate: { gte: contract.effectiveDate, lte: end },
    },
    select: { transactionDate: true, extendedPrice: true },
  })

  // Bucket by YYYY-MM
  const byMonth = new Map<string, number>()
  for (const r of cogRecords) {
    const d = r.transactionDate
    if (!d) continue
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.extendedPrice))
  }

  // Emit every month in the window so buildMonthlyAccruals sees gaps
  // as zero-spend months (important for cumulative + marginal arithmetic).
  const series: MonthlySpend[] = []
  const cursor = new Date(
    Date.UTC(
      contract.effectiveDate.getUTCFullYear(),
      contract.effectiveDate.getUTCMonth(),
      1,
    ),
  )
  const lastMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
  )
  while (cursor <= lastMonth) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
    series.push({ month: key, spend: byMonth.get(key) ?? 0 })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  const rows = buildMonthlyAccruals(series, tiers, method, evaluationPeriod)

  const deleted = await prisma.rebate.deleteMany({
    where: {
      contractId: contract.id,
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
  })

  const toInsert = rows
    .filter((r) => r.accruedAmount > 0)
    .map((r) => {
      const [year, month] = r.month.split("-").map((n) => Number(n))
      const periodStart = new Date(Date.UTC(year, month - 1, 1))
      const periodEnd = new Date(Date.UTC(year, month, 0))
      return {
        contractId: contract.id,
        facilityId: contract.facilityId,
        rebateEarned: r.accruedAmount,
        rebateCollected: 0,
        payPeriodStart: periodStart,
        payPeriodEnd: periodEnd,
        collectionDate: null,
        notes: `${AUTO_ACCRUAL_PREFIX} tier ${r.tierAchieved} @ ${r.rebatePercent}% on $${r.spend.toFixed(2)} (${r.month})`,
      }
    })

  if (toInsert.length === 0) {
    return { skipped: null, inserted: 0, deleted: deleted.count }
  }

  const created = await prisma.rebate.createMany({ data: toInsert })
  return { skipped: null, inserted: created.count, deleted: deleted.count }
}

async function main() {
  const contracts = await loadContracts()
  console.log(`[regen-all-accruals] processing ${contracts.length} contracts with terms`)

  let totalInserted = 0
  let totalDeleted = 0
  const skipReasons = new Map<string, number>()

  for (const c of contracts) {
    const result = await regenerateOne(c)
    totalInserted += result.inserted
    totalDeleted += result.deleted
    if (result.skipped) {
      skipReasons.set(result.skipped, (skipReasons.get(result.skipped) ?? 0) + 1)
    }
    console.log(
      `  ${c.name.padEnd(40).slice(0, 40)}  del=${result.deleted}  new=${result.inserted}${result.skipped ? `  skipped=${result.skipped}` : ""}`,
    )
  }

  console.log()
  console.log(`[regen-all-accruals] TOTAL deleted=${totalDeleted} inserted=${totalInserted}`)
  if (skipReasons.size > 0) {
    console.log(`[regen-all-accruals] skipped:`, Object.fromEntries(skipReasons))
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
