/**
 * Month-bucket helpers for the accrual timeline. Moved verbatim from
 * `lib/actions/contracts/accrual.ts` (2026-08-05 decomposition).
 */
import type { Prisma } from "@/lib/generated/prisma/client"
import type { MonthlySpend } from "@/lib/contracts/accrual"
import type { buildCategoryWhereClause } from "@/lib/contracts/cog-category-filter"

/**
 * Shared YYYY-MM monthly spend bucketing (normal tier-walk path + the
 * `termsWithTiers.length === 0` overlay path — bugs.rtfd 2026-06-11 A4).
 * Buckets the fetched COG rows by transaction month, applies an optional
 * category IN filter (already canonical-expanded by the caller via
 * `buildCategoryWhereClause` / `buildUnionCategoryWhereClause` +
 * `facilityCogCategoryUniverse`), and emits a contiguous series from
 * rangeStart's month through rangeEnd's month so zero-spend months still
 * render.
 */
export function buildMonthlySpendSeriesFromCogRows(
  rows: ReadonlyArray<{
    transactionDate: Date | null
    extendedPrice: Prisma.Decimal | number | null
    category?: string | null
  }>,
  categoryFilter: ReturnType<typeof buildCategoryWhereClause>,
  rangeStart: Date,
  rangeEnd: Date,
): MonthlySpend[] {
  const categoryIn = categoryFilter.category?.in ?? null
  const categorySet = categoryIn ? new Set(categoryIn) : null

  const byMonth = new Map<string, number>()
  for (const r of rows) {
    const d = r.transactionDate
    if (!d) continue
    if (categorySet && !categorySet.has(r.category ?? "")) continue
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.extendedPrice))
  }

  const series: MonthlySpend[] = []
  const cursor = new Date(
    Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1),
  )
  const lastMonth = new Date(
    Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), 1),
  )
  while (cursor <= lastMonth) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
    series.push({ month: key, spend: byMonth.get(key) ?? 0 })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return series
}

/**
 * Evaluation-period bucket key for a YYYY-MM month — drives the
 * Cumulative column's reset boundaries AND the period-subtotal rows.
 * Shared by the normal walk path and the overlay-only early path (A4).
 * Cadences: monthly / quarterly / semi_annual / annual / lifetime —
 * never drop semi_annual (recurring regression class).
 */
export function periodKeyForEval(
  month: string,
  evalPeriod: "monthly" | "quarterly" | "semi_annual" | "annual" | "lifetime",
): string {
  const [y, m] = month.split("-").map((n) => Number(n))
  if (evalPeriod === "monthly") return month
  if (evalPeriod === "quarterly") {
    const q = Math.floor((m - 1) / 3) + 1
    return `${y}-Q${q}`
  }
  if (evalPeriod === "semi_annual") {
    const h = m <= 6 ? 1 : 2
    return `${y}-H${h}`
  }
  if (evalPeriod === "annual") return `${y}`
  return "lifetime"
}

// Local month-key helpers duplicated from `lib/contracts/accrual.ts` —
// the originals are not exported. Keep identical UTC semantics.
export function monthKeyToDate(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month - 1, 1))
}

export function monthKeyEndOfMonth(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month, 0))
}
