// ─── MACRS Depreciation Calculation ────────────────────────────
// Half-year convention rates by recovery period

const MACRS_RATES: Record<number, number[]> = {
  5: [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  10: [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
  15: [5.0, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.95],
}

export interface DepreciationYear {
  year: number
  rate: number
  depreciation: number
  accumulatedDepreciation: number
  bookValue: number
}

export interface DepreciationSchedule {
  assetCost: number
  recoveryPeriod: number
  convention: string
  years: DepreciationYear[]
  totalDepreciation: number
}

export function calculateMACRS(
  assetCost: number,
  recoveryPeriod: 5 | 7 | 10 | 15,
  convention: "half_year" | "mid_quarter" = "half_year"
): DepreciationSchedule {
  const rates = MACRS_RATES[recoveryPeriod]
  if (!rates) {
    throw new Error(`Unsupported recovery period: ${recoveryPeriod}`)
  }

  let accumulated = 0
  const years: DepreciationYear[] = rates.map((rate, idx) => {
    const depreciation = Math.round((assetCost * rate) / 100 * 100) / 100
    accumulated += depreciation
    return {
      year: idx + 1,
      rate,
      depreciation,
      accumulatedDepreciation: Math.round(accumulated * 100) / 100,
      bookValue: Math.round((assetCost - accumulated) * 100) / 100,
    }
  })

  return {
    assetCost,
    recoveryPeriod,
    convention,
    years,
    totalDepreciation: Math.round(accumulated * 100) / 100,
  }
}
