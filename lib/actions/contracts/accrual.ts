"use server"

/**
 * Monthly accrual timeline for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  buildMonthlyAccruals,
  type EvaluationPeriod,
  type MonthlySpend,
} from "@/lib/contracts/accrual"
import type { TierLike, RebateMethodName } from "@/lib/contracts/rebate-method"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"
import { serialize } from "@/lib/serialize"

export async function getAccrualTimeline(contractId: string) {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  // Charles R5.6: pricing-only contracts are not rebate-bearing. The
  // accrual ledger must be empty for them — no phantom rows from COG.
  if (!contractTypeEarnsRebates(contract.contractType)) {
    return serialize({ rows: [], method: "cumulative" as RebateMethodName })
  }

  const term = contract.terms[0]
  if (!term || term.tiers.length === 0) {
    return serialize({ rows: [], method: "cumulative" as RebateMethodName })
  }

  const tiers: TierLike[] = term.tiers.map((t) => ({
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    spendMin: Number(t.spendMin),
    spendMax: t.spendMax ? Number(t.spendMax) : null,
    rebateValue: Number(t.rebateValue),
  }))
  const method: RebateMethodName = term.rebateMethod ?? "cumulative"
  // Honor ContractTerm.evaluationPeriod — per Charles R4.6, monthly-eval
  // contracts should qualify tier by THIS MONTH'S spend, not cumulative
  // annual. Only `monthly` | `quarterly` | `annual` are supported today;
  // anything else falls through to annual (current behavior).
  const evaluationPeriod: EvaluationPeriod =
    term.evaluationPeriod === "monthly" || term.evaluationPeriod === "quarterly"
      ? term.evaluationPeriod
      : "annual"

  const end = new Date(
    Math.min(new Date().getTime(), contract.expirationDate.getTime()),
  )
  // Charles R5.12 — bucket spend by the actual transaction date, not the
  // DB insertion timestamp. Using `createdAt` collapsed every seeded
  // record into the single month the seed ran, which made the Accrual
  // Timeline and Performance Spend-by-Period panels show all activity in
  // one column and every other month as $0.
  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: {
        gte: contract.effectiveDate,
        lte: end,
      },
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

  const rows = buildMonthlyAccruals(series, tiers, method, evaluationPeriod)
  return serialize({ rows, method })
}
