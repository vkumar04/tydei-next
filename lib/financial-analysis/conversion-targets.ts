/**
 * Recommended Conversion Targets — Charles AI Prospective Impact Engine,
 * feature #2 (2026-06-21).
 *
 * Pure function. Given each category's realizable savings opportunity and
 * the share of volume it represents (a proxy for required physician behavior
 * change), it ranks the targets and finds the Pareto knee — the smallest set
 * of categories that captures the majority of the financial benefit for the
 * least behavior change:
 *
 *   "Converting 35% of Sports Medicine volume yields 68% of total financial
 *    benefit while requiring only 18% physician behavior change."
 */

export interface ConversionCategoryInput {
  category: string
  /** Realizable annual savings ($) if converted. */
  savingsOpportunity: number
  /** Share of total surgical volume this category represents (0–1). */
  volumeSharePct: number
  /** Current ASP is above benchmark (a flag worth surfacing). */
  aboveBenchmarkAsp?: boolean
}

export interface ConversionTarget {
  category: string
  savingsOpportunity: number
  /** This category's share of the total benefit (0–1). */
  pctOfTotalBenefit: number
  /** Cumulative benefit share once this and all higher-ranked are converted. */
  cumulativeBenefitPct: number
  volumeSharePct: number
  aboveBenchmarkAsp: boolean
}

export interface ConversionTargetsResult {
  targets: ConversionTarget[]
  /** The Pareto-knee headline, or null when there's nothing to convert. */
  headline: string | null
  /** Total realizable savings across all categories. */
  totalBenefit: number
}

/** Cumulative-benefit threshold that defines the Pareto knee. */
const KNEE_THRESHOLD = 0.66

export function computeConversionTargets(
  categories: ConversionCategoryInput[],
): ConversionTargetsResult {
  const totalBenefit = categories.reduce(
    (s, c) => s + Math.max(0, c.savingsOpportunity),
    0,
  )

  if (totalBenefit <= 0) {
    return { targets: [], headline: null, totalBenefit: 0 }
  }

  const sorted = [...categories]
    .filter((c) => c.savingsOpportunity > 0)
    .sort((a, b) => b.savingsOpportunity - a.savingsOpportunity)

  let cumBenefit = 0
  const targets: ConversionTarget[] = sorted.map((c) => {
    const pct = c.savingsOpportunity / totalBenefit
    cumBenefit += pct
    return {
      category: c.category,
      savingsOpportunity: c.savingsOpportunity,
      pctOfTotalBenefit: pct,
      cumulativeBenefitPct: cumBenefit,
      volumeSharePct: c.volumeSharePct,
      aboveBenchmarkAsp: c.aboveBenchmarkAsp ?? false,
    }
  })

  // Find the knee: the first target whose cumulative benefit crosses the
  // threshold. Use it for the headline.
  const knee =
    targets.find((t) => t.cumulativeBenefitPct >= KNEE_THRESHOLD) ?? targets[0]!

  const headline = `Converting ${pct(knee.volumeSharePct)} of ${
    knee.category
  } volume yields ${pct(
    knee.cumulativeBenefitPct,
  )} of total financial benefit while requiring only ${pct(
    knee.volumeSharePct,
  )} physician behavior change.`

  return { targets, headline, totalBenefit }
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
