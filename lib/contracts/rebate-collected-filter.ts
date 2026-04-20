/**
 * Canonical "Rebates Collected" aggregate.
 *
 * CLAUDE.md invariant: a rebate is **collected** ONLY when a `Rebate` row
 * has a non-null `collectionDate`. Every surface that renders a "Collected"
 * number (contract list row, contract detail header card, contract
 * Transactions tab summary card, dashboard totals, reports, etc.) MUST sum
 * through this helper so the numbers cannot drift apart.
 *
 * Charles W1.R tracked down a case where the header card showed $90,000
 * and the Transactions tab showed $203,702 on the same contract. The
 * server logic already agreed; the mismatch was a stale client chunk, but
 * the duplicated reducer in two call sites was a drift hazard. Funneling
 * everything through one function means any future schema or scoping
 * change (e.g. switching to a dedicated `collectedDate >= X` filter)
 * ripples through every surface atomically.
 *
 * Kept framework-free (no Prisma client import, no server-action imports)
 * so Vitest and client components can both exercise it.
 */

/**
 * Anything with a numeric `toString()` — covers JS `number`, `string`, and
 * Prisma's `Decimal` without pulling `@prisma/client/runtime` into a
 * framework-free module.
 */
interface DecimalLike {
  toString(): string
}

export interface CollectedRebateLike {
  /** null => not yet collected; Date/string => collected on that day */
  collectionDate: Date | string | null | undefined
  /** Prisma Decimal, JS number, numeric string, or null/undefined */
  rebateCollected: DecimalLike | number | string | null | undefined
}

/**
 * Sum the `rebateCollected` amount across rows where `collectionDate` is
 * set (truthy). Rows without a collectionDate — including ContractPeriod
 * rollups that don't have the column at all — contribute $0.
 */
export function sumCollectedRebates(
  rebates: readonly CollectedRebateLike[],
): number {
  return rebates.reduce(
    (sum, r) =>
      r.collectionDate != null ? sum + Number(r.rebateCollected ?? 0) : sum,
    0,
  )
}
