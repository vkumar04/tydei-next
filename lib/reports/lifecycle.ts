/**
 * Reports hub — contract lifecycle distribution.
 *
 * Pure function: given a list of contract rows, bucket them into
 * active / expiring / expired based on expirationDate vs a reference
 * date (defaults to `new Date()`).
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.0
 */

export interface ContractForLifecycle {
  status: "active" | "expired" | "expiring" | "draft" | "pending"
  expirationDate: Date | null
}

export interface LifecycleDistribution {
  active: number
  expiring: number
  expired: number
  /** Non-live statuses — draft/pending/unknown. */
  other: number
}

const EXPIRING_WINDOW_DAYS = 90

/**
 * Bucket a set of contracts into lifecycle stages.
 *
 * Rules:
 *   - status === "expired"              → expired
 *   - expirationDate < reference        → expired (regardless of status)
 *   - status === "expiring"             → expiring
 *   - active AND within 90 days         → expiring
 *   - active AND > 90 days remaining    → active
 *   - anything else (draft/pending)     → other
 */
export function computeContractLifecycleDistribution(
  contracts: ContractForLifecycle[],
  referenceDate: Date = new Date(),
): LifecycleDistribution {
  const refMs = referenceDate.getTime()
  const windowMs = EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000

  let active = 0
  let expiring = 0
  let expired = 0
  let other = 0

  for (const c of contracts) {
    if (c.status === "expired") {
      expired++
      continue
    }
    if (c.expirationDate && c.expirationDate.getTime() < refMs) {
      expired++
      continue
    }
    if (c.status === "expiring") {
      expiring++
      continue
    }
    if (c.status === "active") {
      if (
        c.expirationDate &&
        c.expirationDate.getTime() - refMs <= windowMs
      ) {
        expiring++
      } else {
        active++
      }
      continue
    }
    other++
  }

  return { active, expiring, expired, other }
}
