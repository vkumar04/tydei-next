// ─── Linear Regression ──────────────────────────────────────────

export function linearRegression(values: number[]): {
  slope: number
  intercept: number
  r2: number
} {
  const n = values.length
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 }

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  let sumYY = 0

  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += values[i]
    sumXY += i * values[i]
    sumXX += i * i
    sumYY += values[i] * values[i]
  }

  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) return { slope: 0, intercept: sumY / n, r2: 0 }

  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n

  const ssTot = sumYY - (sumY * sumY) / n
  const ssRes = values.reduce((sum, y, i) => {
    const predicted = slope * i + intercept
    return sum + (y - predicted) ** 2
  }, 0)

  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  return { slope, intercept, r2 }
}

// ─── Seasonal Decomposition ────────────────────────────────────

export function seasonalDecompose(values: number[], seasonLength = 12): number[] {
  if (values.length < seasonLength) {
    return new Array(seasonLength).fill(0)
  }

  const { slope, intercept } = linearRegression(values)
  const detrended = values.map((v, i) => v - (slope * i + intercept))

  const seasonal = new Array(seasonLength).fill(0)
  const counts = new Array(seasonLength).fill(0)

  for (let i = 0; i < detrended.length; i++) {
    const idx = i % seasonLength
    seasonal[idx] += detrended[i]
    counts[idx]++
  }

  for (let i = 0; i < seasonLength; i++) {
    seasonal[i] = counts[i] > 0 ? seasonal[i] / counts[i] : 0
  }

  return seasonal
}
