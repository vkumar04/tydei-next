/**
 * Cross-surface invariant harness — roadmap track 8c.
 *
 * Generalizes the W1.X-D list-vs-detail parity test so any "this
 * number must be the same wherever it's shown" invariant can be
 * locked down with a single assertion.
 *
 * The CLAUDE.md invariants table names one canonical helper per
 * business number (sumCollectedRebates, sumEarnedRebatesYTD, etc.).
 * Every display surface rendering that number MUST call the helper.
 * In practice drift has dominated Charles's feedback (W1.R, W1.U-B,
 * W1.X-D, W1.Y-C) when a callsite forgot, so this harness exists
 * specifically to make such drift a test failure.
 *
 * Usage:
 *
 *   const invariant = registerInvariant({
 *     name: "rebates collected (lifetime)",
 *     reducers: {
 *       canonical: (rows) => sumCollectedRebates(rows),
 *       listScreenSurrogate: (rows) => rows.filter(…).reduce(…),
 *       dashboardTileSurrogate: (rows) => …,
 *     },
 *   })
 *   assertInvariantHolds(invariant, rebateRows)
 *
 * The harness re-runs every reducer on the same input and throws
 * with a diff of which surfaces disagree + the expected value.
 */

type Reducer<T> = (input: T) => number

export interface Invariant<T> {
  name: string
  reducers: Record<string, Reducer<T>>
}

export function registerInvariant<T>(def: Invariant<T>): Invariant<T> {
  if (Object.keys(def.reducers).length < 2) {
    throw new Error(
      `Invariant "${def.name}" needs at least 2 reducers — the whole point is comparing surfaces. Got ${Object.keys(def.reducers).length}.`,
    )
  }
  return def
}

export interface InvariantViolation {
  name: string
  reducerName: string
  got: number
  expected: number
  delta: number
}

/**
 * Run every reducer on the same input and return any that disagree
 * with the canonical reducer. Canonical is picked as:
 *   - The reducer keyed `canonical` if present.
 *   - Otherwise the first registered reducer.
 *
 * Numeric tolerance is 0.01 (1¢) to absorb floating-point drift that
 * isn't real disagreement.
 */
export function checkInvariant<T>(
  invariant: Invariant<T>,
  input: T,
  tolerance = 0.01,
): InvariantViolation[] {
  const keys = Object.keys(invariant.reducers)
  const canonicalKey = keys.includes("canonical") ? "canonical" : keys[0]!
  const canonicalFn = invariant.reducers[canonicalKey]!
  const expected = canonicalFn(input)

  const violations: InvariantViolation[] = []
  for (const [name, fn] of Object.entries(invariant.reducers)) {
    if (name === canonicalKey) continue
    const got = fn(input)
    const delta = Math.abs(got - expected)
    if (delta > tolerance) {
      violations.push({
        name: invariant.name,
        reducerName: name,
        got,
        expected,
        delta,
      })
    }
  }
  return violations
}

/**
 * Throws with a readable multi-line error when any reducer drifts.
 * Meant to be called from Vitest `it()` — a failure lists every
 * surface that disagreed so the fix target is obvious.
 */
export function assertInvariantHolds<T>(
  invariant: Invariant<T>,
  input: T,
  tolerance = 0.01,
): void {
  const violations = checkInvariant(invariant, input, tolerance)
  if (violations.length === 0) return
  const lines = [
    `Invariant "${invariant.name}" violated by ${violations.length} reducer(s):`,
    ...violations.map(
      (v) =>
        `  • ${v.reducerName}: got ${v.got}, expected ${v.expected} (delta ${v.delta.toFixed(4)})`,
    ),
  ]
  throw new Error(lines.join("\n"))
}
