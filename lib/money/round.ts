/**
 * Canonical money rounding (2026-07-29 math audit, error class 5).
 *
 * THE PROBLEM. The codebase rounded dollars with `Math.round(x * 100) / 100`.
 * That is not half-up rounding on the decimal value — it is half-up rounding on
 * whatever float64 happens to represent `x * 100`, and for a quarter of all
 * two-decimal half-cent boundaries those disagree:
 *
 *     Math.round(1.005 * 100) / 100  ->  1     (correct: 1.01)
 *     Math.round(8.165 * 100) / 100  ->  8.16  (correct: 8.17)
 *
 * Measured across the 200,000 half-cent boundaries from $0.005 to $2,000.005,
 * `Math.round(x*100)/100` disagrees with the decimal-correct answer on 48,643
 * of them — 24%. Every one is a one-cent error, always in the same direction
 * (down), so it does not cancel out across a ledger: it accumulates as a
 * systematic under-statement.
 *
 * WHY DECIMAL.JS AND NOT MORE FLOAT. The bug is that the binary representation
 * of a decimal fraction is not the decimal fraction. No amount of float
 * cleverness fixes that; you need arithmetic that works in base 10. decimal.js
 * is the same library Prisma already uses for its `Decimal` columns ("Decimal
 * fields are represented by the Decimal.js library" — Prisma ORM 7 docs), so
 * this introduces no new numeric model, just applies the existing one earlier.
 *
 * WHAT THIS IS NOT FOR. Accumulating sums. Float64 handles that fine at this
 * scale — summing all 49,269 production COG rows drifts $0.00000037, four
 * orders of magnitude below a cent. Rounding is the step where float loses a
 * whole cent at once; addition is not. Do not convert hot summation loops to
 * Decimal on the strength of this file.
 */

import Decimal from "decimal.js"

/**
 * Round a dollar amount to cents, half away from zero.
 *
 * Half-UP (away from zero) is the convention Postgres `numeric` uses when a
 * value lands in a `Decimal(_, 2)` column, so rounding here agrees with what
 * the database would have done — a value rounded in JS and the same value
 * rounded on write cannot disagree by a cent.
 *
 * Negative amounts round away from zero too (-1.005 -> -1.01), which keeps
 * `roundToCents(-x) === -roundToCents(x)` and stops a credit and its matching
 * debit differing by a cent.
 *
 * Non-finite input returns 0 rather than propagating NaN/Infinity into a money
 * column — a silent zero is bad, but a NaN written to Decimal(14,2) is worse,
 * and callers should not be handing this function garbage in the first place.
 */
export function roundToCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  return new Decimal(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}

/**
 * Round to an arbitrary number of decimal places, half away from zero.
 *
 * For percentages and rates, where the display convention is 2dp but the value
 * is not money. Same base-10 correctness as `roundToCents`.
 */
export function roundTo(value: number, decimalPlaces: number): number {
  if (!Number.isFinite(value)) return 0
  return new Decimal(value)
    .toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP)
    .toNumber()
}

/**
 * Sum dollar amounts and round the total ONCE, at the end.
 *
 * Rounding each addend first and then summing ("round-then-sum") lets up to
 * half a cent of error per row accumulate into a total that does not match the
 * figure anyone would get by adding the unrounded values. Summing first and
 * rounding once ("sum-then-round") keeps the total consistent with its own
 * inputs. Use this wherever a displayed total must reconcile against the rows
 * beneath it.
 */
export function sumToCents(amounts: readonly number[]): number {
  let total = 0
  for (const a of amounts) if (Number.isFinite(a)) total += a
  return roundToCents(total)
}
