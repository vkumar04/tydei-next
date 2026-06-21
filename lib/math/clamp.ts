/**
 * Canonical clamp helpers — one home for the `Math.min(hi, Math.max(lo, n))`
 * pattern that was copy-pasted (with drifting NaN handling) across the
 * financial-scoring and dashboard modules. NaN coerces to the low bound so
 * scoring math never propagates NaN.
 */

/** Clamp `n` into [min, max]. NaN → min. */
export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** Clamp into [0, 1]. NaN → 0. */
export function clamp01(n: number): number {
  return clamp(n, 0, 1)
}

/** Clamp into [0, 100]. NaN → 0. */
export function clamp0100(n: number): number {
  return clamp(n, 0, 100)
}
