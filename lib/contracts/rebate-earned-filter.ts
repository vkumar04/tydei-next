/**
 * Canonical "Rebates Earned" aggregate.
 *
 * CLAUDE.md invariant: a rebate is **earned** ONLY when the underlying
 * `Rebate` row's pay period has closed — i.e. `payPeriodEnd <= today`.
 * Pre-recorded rows for future periods are projections, not earned. A
 * contract's "earned" figure renders on at least four surfaces: the
 * contract detail header card (YTD slice), the contract list earned
 * column (YTD slice), the Transactions tab summary card (lifetime
 * ledger), and the dashboard / reports rollups. Every one of those
 * MUST sum through this helper so the numbers cannot drift apart.
 *
 * Charles W1.U-B tracked down a case where the detail header card
 * showed $1,121 (YTD) while the Transactions tab summed to thousands
 * more (lifetime) — same invariant, two separate reducers, two
 * separate answers. Both numbers were legitimate for their scope, but
 * the duplicated reducers were a drift hazard: a future schema or
 * scoping change (e.g. swapping `payPeriodEnd` for an `earnedDate`
 * column) would have to be chased across every call site. Funneling
 * through one helper means one place to change.
 *
 * This is the sibling of `sumCollectedRebates` in
 * `rebate-collected-filter.ts`, which W1.R canonicalized for the
 * "Collected" invariant. Kept framework-free (no Prisma client
 * import, no server-action imports) so Vitest and client components
 * can both exercise it.
 */

/**
 * Anything with a numeric `toString()` — covers JS `number`, `string`,
 * and Prisma's `Decimal` without pulling `@prisma/client/runtime` into
 * a framework-free module.
 */
interface DecimalLike {
  toString(): string
}

export interface EarnedRebateLike {
  /** null => missing / not-yet-scheduled; Date/string => period end date */
  payPeriodEnd: Date | string | null | undefined
  /** Prisma Decimal, JS number, numeric string, or null/undefined */
  rebateEarned: DecimalLike | number | string | null | undefined
}

/**
 * Coerce a `Date | string | null | undefined` into a `Date | null`.
 * Rows with no `payPeriodEnd` contribute $0 (can't decide if they're
 * closed). Invalid date strings are treated the same as null.
 */
function coercePayPeriodEnd(
  value: Date | string | null | undefined,
): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Sum `rebateEarned` across rows whose `payPeriodEnd` is on or before
 * `today`. Rows without a `payPeriodEnd`, or whose `payPeriodEnd` is
 * in the future, contribute $0. This is the **lifetime** earned figure
 * used by the Transactions tab summary card.
 *
 * `today` defaults to `new Date()` — override for deterministic tests.
 */
export function sumEarnedRebatesLifetime(
  rebates: readonly EarnedRebateLike[],
  today: Date = new Date(),
): number {
  return rebates.reduce((sum, r) => {
    const end = coercePayPeriodEnd(r.payPeriodEnd)
    if (end === null) return sum
    if (end > today) return sum
    return sum + Number(r.rebateEarned ?? 0)
  }, 0)
}

/**
 * Sum `rebateEarned` across rows whose `payPeriodEnd` is on or before
 * `today` AND on or after Jan 1 of `today`'s calendar year. This is
 * the **year-to-date** earned figure used by the contract detail
 * header card and the contracts-list earned column.
 *
 * `today` defaults to `new Date()` — override for deterministic tests.
 */
export function sumEarnedRebatesYTD(
  rebates: readonly EarnedRebateLike[],
  today: Date = new Date(),
): number {
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  return rebates.reduce((sum, r) => {
    const end = coercePayPeriodEnd(r.payPeriodEnd)
    if (end === null) return sum
    if (end > today) return sum
    if (end < startOfYear) return sum
    return sum + Number(r.rebateEarned ?? 0)
  }, 0)
}
