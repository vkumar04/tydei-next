/**
 * Deterministic warnings + opportunities generator for proposal cards.
 * Seeded by proposal id so the same proposal always shows the same
 * chips — avoids the demo-state flicker where cards would swap labels
 * on every render.
 */

const ALL_WARNINGS = [
  "Price above market average on 3 items",
  "Contract duration exceeds 24 months",
  "Missing rebate escalation clause",
  "Below-average compliance score",
  "Limited product category coverage",
]

const ALL_OPPORTUNITIES = [
  "Volume discount eligible at current spend",
  "Bundle with related categories for 8% savings",
  "Early renewal incentive available",
  "Market share growth potential in 2 facilities",
  "Rebate tier upgrade within reach",
]

export function generateInsights(seed: string): {
  warnings: string[]
  opportunities: string[]
} {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0
  const r = (min: number, max: number) => {
    h = (h * 16807 + 12345) & 0x7fffffff
    return min + (h % (max - min + 1))
  }

  const warnCount = r(0, 2)
  const oppCount = r(1, 3)
  const warnings: string[] = []
  const opportunities: string[] = []
  for (let i = 0; i < warnCount; i++) warnings.push(ALL_WARNINGS[r(0, ALL_WARNINGS.length - 1)]!)
  for (let i = 0; i < oppCount; i++)
    opportunities.push(ALL_OPPORTUNITIES[r(0, ALL_OPPORTUNITIES.length - 1)]!)
  return { warnings: [...new Set(warnings)], opportunities: [...new Set(opportunities)] }
}
