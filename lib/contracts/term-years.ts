/**
 * Compute the contract term length in years using calendar-month math.
 *
 * The naive `(expMs - effMs) / (365.25 * day-ms)` produces non-intuitive
 * decimals (a Jan 1 → Dec 31 contract is 0.999 years, which gets floored
 * to 1.0 via `Math.max(1, …)` but produces weird downstream values when
 * the contract spans an odd number of months).
 *
 * This helper uses inclusive month arithmetic so whole-year contracts
 * always snap to integer years:
 *
 *  - Jan 1 2024 → Dec 31 2024 → 12 months → **1.0 years**
 *  - Jan 1 2024 → Dec 31 2026 → 36 months → **3.0 years**
 *  - Jan 1 2024 → Nov 25 2026 → 35 months → **2.917 years**
 *  - Jan 1 2024 → Jan 15 2025 → 13 months → **1.083 years**
 *
 * Returns 1 when either date is missing, invalid, the range is
 * zero/negative, OR the expiration is the evergreen sentinel — matches
 * the old `Math.max(1, …)` floor so the result can always be used as a
 * divisor without producing absurdly-large or NaN outputs.
 */
import { EVERGREEN_MS } from "@/lib/contracts/evergreen"
export function computeContractYears(
  effectiveDate: Date | string | null | undefined,
  expirationDate: Date | string | null | undefined,
): number {
  if (!effectiveDate || !expirationDate) return 1
  const eff = effectiveDate instanceof Date ? effectiveDate : new Date(effectiveDate)
  const exp = expirationDate instanceof Date ? expirationDate : new Date(expirationDate)
  if (isNaN(eff.getTime()) || isNaN(exp.getTime())) return 1
  if (exp.getTime() <= eff.getTime()) return 1
  // Evergreen sentinel: an evergreen contract has no defined term length,
  // so auto-compute callers that do `totalValue / years` shouldn't see
  // 7976 (sentinel year - effective year). Treat as 1 year so annualValue
  // defaults to contractValue; the user can edit if the real intent is
  // different.
  if (exp.getTime() === EVERGREEN_MS) return 1

  // Inclusive-month count. Jan 1 → Dec 31 of same year = 12 months,
  // not 11: the start month counts in full and the end month counts
  // because the expiration falls inside it.
  const months =
    (exp.getUTCFullYear() - eff.getUTCFullYear()) * 12 +
    (exp.getUTCMonth() - eff.getUTCMonth() + 1)

  return Math.max(1, months / 12)
}
