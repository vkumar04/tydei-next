/**
 * Net Present Value (NPV) and Internal Rate of Return (IRR).
 *
 * Pure functions that operate on a cash-flow series. The series uses the
 * convention cashflows[0] = initial outlay (typically negative) and
 * cashflows[1..n] = periodic inflows. Periods are assumed uniform (one
 * year each) and there is no mid-period compounding.
 */

/**
 * Compute Net Present Value of a cash-flow series at a given discount rate.
 *
 * Formula:
 *   NPV = Σ_{t=0..n} cashflows[t] / (1 + discountRate)^t
 *
 * By convention cashflows[0] is the initial outlay at t=0 (not discounted
 * because (1 + r)^0 = 1). Subsequent values are discounted one period each.
 *
 * A discount rate of 0 short-circuits to a plain sum of the cashflows.
 */
export function computeNPV(cashflows: number[], discountRate: number): number {
  if (discountRate === 0) {
    let sum = 0
    for (const cf of cashflows) sum += cf
    return sum
  }

  let npv = 0
  for (let t = 0; t < cashflows.length; t++) {
    const cf = cashflows[t] as number
    npv += cf / Math.pow(1 + discountRate, t)
  }
  return npv
}

export interface IRROptions {
  /** Maximum bisection iterations. Defaults to 100. */
  maxIterations?: number
  /** Convergence tolerance on NPV (dollars). Defaults to 1e-6. */
  tolerance?: number
}

/**
 * Compute Internal Rate of Return using bisection.
 *
 * IRR is defined as the discount rate r such that NPV(cashflows, r) = 0.
 * We use the bisection method with bounds [-0.99, 10.0] — i.e. we search
 * for an IRR between −99% and +1000%, which covers the vast majority of
 * real-world capital-contract scenarios without risking division-by-zero
 * at r = -1.
 *
 * Algorithm:
 *   1. If the cash-flow series has no sign change, there is no real IRR
 *      (NPV is monotonic in r in that regime); return null.
 *   2. Evaluate NPV at lo and hi bounds; if they share a sign there is
 *      no crossing in the interval; return null.
 *   3. Bisect: at each iteration compute NPV at the midpoint, narrow the
 *      bracket to whichever half still brackets zero. Stop when |NPV|
 *      falls below `tolerance` or we exhaust `maxIterations`.
 *
 * Returns the IRR as a decimal (0.128 = 12.8%) or null if no root is
 * found in [-0.99, 10.0].
 */
export function computeIRR(
  cashflows: number[],
  options?: IRROptions,
): number | null {
  const maxIterations = options?.maxIterations ?? 100
  const tolerance = options?.tolerance ?? 1e-6

  // Precondition: at least one positive and one negative cash flow.
  let hasPositive = false
  let hasNegative = false
  for (const cf of cashflows) {
    if (cf > 0) hasPositive = true
    else if (cf < 0) hasNegative = true
  }
  if (!hasPositive || !hasNegative) return null

  let lo = -0.99
  let hi = 10.0

  let npvLo = computeNPV(cashflows, lo)
  let npvHi = computeNPV(cashflows, hi)

  // No sign change in the bracket → bisection cannot converge.
  if (npvLo === 0) return lo
  if (npvHi === 0) return hi
  if ((npvLo > 0 && npvHi > 0) || (npvLo < 0 && npvHi < 0)) return null

  for (let i = 0; i < maxIterations; i++) {
    const mid = (lo + hi) / 2
    const npvMid = computeNPV(cashflows, mid)

    if (Math.abs(npvMid) < tolerance) return mid

    if ((npvMid > 0 && npvLo > 0) || (npvMid < 0 && npvLo < 0)) {
      lo = mid
      npvLo = npvMid
    } else {
      hi = mid
      npvHi = npvMid
    }
  }

  return (lo + hi) / 2
}
