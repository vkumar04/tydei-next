/**
 * Ordinary least-squares linear regression for numeric series.
 *
 * Ported from the v0 prototype's `lib/forecasting.ts` as part of the
 * rebate-engine improvement roadmap (track 3 — "projection → forecast
 * with confidence"). Pure function, zero dependencies.
 *
 * Given (x, y) points, fits `y = slope·x + intercept` and reports
 * r² (coefficient of determination, clamped to [0, 1]).
 */

export interface RegressionPoint {
  x: number
  y: number
}

export interface RegressionResult {
  slope: number
  intercept: number
  /** 0–1. Closer to 1 = better fit; <0.5 = weak trend. */
  r2: number
}

export function linearRegression(
  data: readonly RegressionPoint[],
): RegressionResult {
  const n = data.length
  if (n < 2) {
    return { slope: 0, intercept: data[0]?.y ?? 0, r2: 0 }
  }

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0

  for (const point of data) {
    sumX += point.x
    sumY += point.y
    sumXY += point.x * point.y
    sumX2 += point.x * point.x
  }

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) {
    // All x are identical — slope undefined; report mean as intercept.
    return { slope: 0, intercept: sumY / n, r2: 0 }
  }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // R² = 1 − SSres / SStot.
  const yMean = sumY / n
  let ssRes = 0
  let ssTot = 0
  for (const point of data) {
    const predicted = slope * point.x + intercept
    ssRes += (point.y - predicted) ** 2
    ssTot += (point.y - yMean) ** 2
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  return {
    slope,
    intercept,
    r2: Math.max(0, Math.min(1, r2)),
  }
}
