"use server"

/**
 * Regenerate Rebate rows for a contract from its current term +
 * tier configuration (Charles R5.21).
 *
 * Background: `getAccrualTimeline` computes accruals on-the-fly for
 * display and NEVER writes to the database, while the contract detail
 * "Rebates Earned" card reads from `prisma.rebate` rows (per the
 * CLAUDE.md "never auto-compute rebates for display" rule).
 *
 * That split means when a user edits `ContractTerm.evaluationPeriod`
 * (or any other field that changes the accrual shape), the detail card
 * continues to show the stale $0 — no Rebate rows exist under the new
 * cadence until we regenerate them.
 *
 * This action owns that regeneration. It is safe to call repeatedly:
 *
 *   1. Delete all system-generated Rebate rows for the contract. Rows
 *      are identified by the `[auto-accrual]` notes prefix so manually
 *      entered rebates (`createContractTransaction` with type=rebate)
 *      are preserved.
 *   2. Walk the same compute path `getAccrualTimeline` uses, and write
 *      one Rebate row per month with a non-zero accrual, tagging each
 *      with the `[auto-accrual]` prefix.
 *
 * Called automatically at the end of every term save — create, update,
 * delete, and tier upsert — in `lib/actions/contract-terms.ts`.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  buildMonthlyAccruals,
  type EvaluationPeriod,
  type MonthlySpend,
} from "@/lib/contracts/accrual"
import type {
  RebateMethodName,
  TierLike,
} from "@/lib/contracts/rebate-method"

// The notes prefix marks rows this action owns so it can rewrite them
// safely without touching manually-entered rebate rows. Must stay a
// local (non-exported) const — `"use server"` files can only export
// async functions per the CLAUDE.md convention.
const AUTO_ACCRUAL_PREFIX = "[auto-accrual]"

export interface RecomputeAccrualResult {
  deleted: number
  inserted: number
}

export async function recomputeAccrualForContract(
  contractId: string,
): Promise<RecomputeAccrualResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUnique({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  // If the contract isn't visible to this facility, bail quietly — the
  // caller already validated the write. This just means we can't
  // recompute (e.g. cross-facility test fixtures).
  if (!contract) {
    return { deleted: 0, inserted: 0 }
  }

  // Always wipe the previous auto-accrual rows first so a term edit
  // that shrinks the accrual window (e.g. fewer months qualify) drops
  // the now-obsolete entries. Manual rebates are preserved by the
  // `notes` prefix filter.
  const deleteResult = await prisma.rebate.deleteMany({
    where: {
      contractId,
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
  })

  const term = contract.terms[0]
  if (!term || term.tiers.length === 0) {
    return { deleted: deleteResult.count, inserted: 0 }
  }

  const tiers: TierLike[] = term.tiers.map((t) => ({
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    spendMin: Number(t.spendMin),
    spendMax: t.spendMax ? Number(t.spendMax) : null,
    rebateValue: Number(t.rebateValue),
  }))
  const method: RebateMethodName = term.rebateMethod ?? "cumulative"
  const evaluationPeriod: EvaluationPeriod =
    term.evaluationPeriod === "monthly" || term.evaluationPeriod === "quarterly"
      ? term.evaluationPeriod
      : "annual"

  // Bound the accrual window by today — future months have no actuals
  // and shouldn't emit Rebate rows (those would leak into "earned"
  // aggregates that filter on payPeriodEnd <= today).
  const end = new Date(
    Math.min(new Date().getTime(), contract.expirationDate.getTime()),
  )

  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      createdAt: { gte: contract.effectiveDate, lte: end },
    },
    select: { createdAt: true, extendedPrice: true },
  })

  const byMonth = new Map<string, number>()
  for (const r of cogRecords) {
    const d = r.createdAt
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

  // Only persist months with non-zero accrual — a monthly-eval contract
  // whose tier 1 spendMin was missed in month N shouldn't pollute the
  // Rebate table with zeros. Aggregations that SUM over Rebate rows
  // treat missing months as $0 anyway.
  const toInsert = rows
    .filter((r) => r.accruedAmount > 0)
    .map((r) => {
      const [year, month] = r.month.split("-").map((n) => Number(n))
      const periodStart = new Date(Date.UTC(year, month - 1, 1))
      const periodEnd = new Date(Date.UTC(year, month, 0))
      return {
        contractId,
        facilityId: facility.id,
        rebateEarned: r.accruedAmount,
        rebateCollected: 0,
        payPeriodStart: periodStart,
        payPeriodEnd: periodEnd,
        collectionDate: null,
        notes: `${AUTO_ACCRUAL_PREFIX} tier ${r.tierAchieved} @ ${r.rebatePercent}% on $${r.spend.toFixed(2)} (${r.month})`,
      }
    })

  if (toInsert.length === 0) {
    return { deleted: deleteResult.count, inserted: 0 }
  }

  const createResult = await prisma.rebate.createMany({ data: toInsert })

  return { deleted: deleteResult.count, inserted: createResult.count }
}
