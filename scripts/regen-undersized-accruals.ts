/**
 * regen-undersized-accruals — Charles W1.V cleanup.
 *
 * W1.V fixed `recomputeAccrualForContract` to scale `rebateValue × 100`
 * at the Prisma boundary (mirroring W1.S's display-side fix). Any
 * existing `[auto-accrual]` Rebate rows written before this fix store
 * `rebateEarned` values that are 100× too small. This script walks every
 * contract that currently has `[auto-accrual]` rows in the DB,
 * regenerates them with the correct scaling, and reports before/after
 * totals so a human can eyeball the magnitude of the correction.
 *
 * It does NOT delete manually-entered Rebate rows (the `[auto-accrual]`
 * notes prefix is the only set it touches — see recompute-accrual.ts).
 *
 * Idempotent: safe to re-run. Ratios should stabilize at ~1.0 once every
 * contract has been regenerated under the W1.V engine.
 *
 * Usage: `bun --env-file=.env scripts/regen-undersized-accruals.ts`
 */
import { prisma } from "@/lib/db"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"
import {
  bucketAccrualsByCadence,
  buildMultiTermMonthlyAccruals,
  type MonthlySpend,
  type EvaluationPeriod,
  type PaymentCadence,
  type TermAccrualConfig,
} from "@/lib/contracts/accrual"
import type { TierLike, RebateMethodName } from "@/lib/rebates/calculate"
import { scaleRebateValueForEngine } from "@/lib/rebates/calculate"

const AUTO_ACCRUAL_PREFIX = "[auto-accrual]"

type ContractRow = Awaited<ReturnType<typeof loadAffectedContracts>>[number]

async function loadAffectedContracts() {
  // Only contracts that currently have at least one `[auto-accrual]`
  // Rebate row — those are the ones W1.S's bug touched. Pulling every
  // contract would also sweep fresh ones that never had auto-accruals,
  // wasting DB time for no behavior change.
  const affected = await prisma.rebate.findMany({
    where: { notes: { startsWith: AUTO_ACCRUAL_PREFIX } },
    select: { contractId: true },
    distinct: ["contractId"],
  })
  const ids = affected.map((r) => r.contractId).filter((id): id is string => id !== null)
  if (ids.length === 0) return []
  return prisma.contract.findMany({
    where: { id: { in: ids } },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })
}

async function sumAutoAccrual(contractId: string): Promise<number> {
  const agg = await prisma.rebate.aggregate({
    where: {
      contractId,
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
    _sum: { rebateEarned: true },
  })
  return Number(agg._sum.rebateEarned ?? 0)
}

async function regenerateOne(contract: ContractRow) {
  if (!contractTypeEarnsRebates(contract.contractType)) {
    return { skipped: "pricing_only" as const, inserted: 0, deleted: 0 }
  }

  const termsWithTiers = contract.terms.filter((t) => t.tiers.length > 0)
  if (termsWithTiers.length === 0) {
    return { skipped: "no_term_or_tiers" as const, inserted: 0, deleted: 0 }
  }

  // Charles W1.V — route scaling through the shared helper so this
  // backfill path uses the same unit convention as
  // `recomputeAccrualForContract` and `getAccrualTimeline`.
  const termConfigs: TermAccrualConfig[] = termsWithTiers.map((term) => {
    const tiers: TierLike[] = term.tiers.map((t) => ({
      tierNumber: t.tierNumber,
      spendMin: t.spendMin,
      spendMax: t.spendMax,
      rebateValue: scaleRebateValueForEngine(t.rebateValue, t.rebateType),
      rebateType: t.rebateType,
    }))
    const method: RebateMethodName =
      term.rebateMethod === "marginal" ? "marginal" : "cumulative"
    const ep = term.evaluationPeriod
    const evaluationPeriod: EvaluationPeriod =
      ep === "monthly" ||
      ep === "quarterly" ||
      ep === "semi_annual" ||
      ep === "annual"
        ? ep
        : "annual"
    return {
      tiers,
      method,
      evaluationPeriod,
      effectiveStart: term.effectiveStart ?? null,
      effectiveEnd: term.effectiveEnd ?? null,
    }
  })

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

  const byMonth = new Map<string, number>()
  for (const r of cogRecords) {
    const d = r.transactionDate
    if (!d) continue
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.extendedPrice))
  }

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

  const rows = buildMultiTermMonthlyAccruals(series, termConfigs)

  const primaryCadence: PaymentCadence =
    (contract.paymentCadence as PaymentCadence | null | undefined) ??
    "monthly"
  const buckets = bucketAccrualsByCadence(rows, primaryCadence)

  const deleted = await prisma.rebate.deleteMany({
    where: {
      contractId: contract.id,
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
  })

  const toInsert = buckets.map((b) => {
    const noteBody =
      b.termCount > 1
        ? `${b.termCount} terms combined on $${b.totalSpend.toFixed(2)} (${b.label})`
        : `${b.label} · tier ${b.tierAchieved} @ ${b.rebatePercent}% on $${b.totalSpend.toFixed(2)}`
    return {
      contractId: contract.id,
      facilityId: contract.facilityId,
      rebateEarned: b.rebateEarned,
      rebateCollected: 0,
      payPeriodStart: b.periodStart,
      payPeriodEnd: b.periodEnd,
      collectionDate: null,
      notes: `${AUTO_ACCRUAL_PREFIX} ${noteBody}`,
    }
  })

  if (toInsert.length === 0) {
    return { skipped: null, inserted: 0, deleted: deleted.count }
  }

  const created = await prisma.rebate.createMany({ data: toInsert })
  return { skipped: null, inserted: created.count, deleted: deleted.count }
}

function fmtUSD(n: number): string {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n)
  return s + " ".repeat(n - s.length)
}

async function main() {
  const contracts = await loadAffectedContracts()
  console.log(
    `[regen-undersized-accruals] ${contracts.length} contracts have [auto-accrual] rows; processing`,
  )

  const NAME_W = 40
  const NUM_W = 14
  const header =
    pad("Contract", NAME_W) +
    "  " +
    pad("before", NUM_W).padStart(NUM_W) +
    "  " +
    pad("after", NUM_W).padStart(NUM_W) +
    "  " +
    "ratio"
  console.log(header)
  console.log("-".repeat(header.length))

  let totalBefore = 0
  let totalAfter = 0
  const skipReasons = new Map<string, number>()

  for (const c of contracts) {
    const before = await sumAutoAccrual(c.id)
    const result = await regenerateOne(c)
    if (result.skipped) {
      skipReasons.set(result.skipped, (skipReasons.get(result.skipped) ?? 0) + 1)
      console.log(`${pad(c.name, NAME_W)}  ${pad(fmtUSD(before), NUM_W).padStart(NUM_W)}  ${pad("--skipped--", NUM_W).padStart(NUM_W)}  (${result.skipped})`)
      continue
    }
    const after = await sumAutoAccrual(c.id)
    totalBefore += before
    totalAfter += after
    const ratio = before > 0 ? (after / before).toFixed(1) + "×" : "n/a"
    console.log(
      `${pad(c.name, NAME_W)}  ${pad(fmtUSD(before), NUM_W).padStart(NUM_W)}  ${pad(fmtUSD(after), NUM_W).padStart(NUM_W)}  ${ratio}`,
    )
  }

  console.log("-".repeat(header.length))
  const totalRatio = totalBefore > 0 ? (totalAfter / totalBefore).toFixed(1) + "×" : "n/a"
  console.log(
    `${pad("TOTAL", NAME_W)}  ${pad(fmtUSD(totalBefore), NUM_W).padStart(NUM_W)}  ${pad(fmtUSD(totalAfter), NUM_W).padStart(NUM_W)}  ${totalRatio}`,
  )
  if (skipReasons.size > 0) {
    console.log(`[regen-undersized-accruals] skipped:`, Object.fromEntries(skipReasons))
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
