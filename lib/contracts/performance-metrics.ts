/**
 * Contract performance metrics: vendor spend concentration and renewal
 * risk scoring.
 *
 * Migrated out of `lib/v0-spec/` on 2026-07-29 with ZERO behaviour change,
 * pinned by golden values captured from the old module — see
 * `lib/contracts/__tests__/v0-migration-parity.test.ts`.
 *
 * See `lib/contracts/tie-in-bundle-math.ts` for why `v0-spec` went away.
 */

// ─── Vendor spend concentration ─────────────────────────────────────

export interface SpendConcentration {
  hhi: number
  level: "low" | "moderate" | "high"
  topVendorSharePct: number
  top3SharePct: number
}

/**
 * Herfindahl-Hirschman Index over vendor spend share.
 *
 *   HHI = Σ (share as a PERCENT)²
 *
 * The percent scale is what makes the familiar thresholds work: a single
 * vendor holding everything scores 100² = 10,000, and the bands below
 * (1500 / 2500) are the standard antitrust cutoffs on that same scale.
 * Computing shares as fractions instead would yield a max of 1.0 and make
 * every result "low" — a silent, total misclassification.
 *
 * Zero or negative total spend returns a zeroed result rather than dividing
 * by zero. Note that means "no spend" and "one vendor with zero spend" both
 * report `low`; concentration is undefined without spend.
 */
export function spendConcentration(
  vendorSpends: Array<{ vendorId: string; spend: number }>,
): SpendConcentration {
  const total = vendorSpends.reduce((s, v) => s + v.spend, 0)
  if (total <= 0) {
    return { hhi: 0, level: "low", topVendorSharePct: 0, top3SharePct: 0 }
  }
  const shares = vendorSpends
    .map((v) => (v.spend / total) * 100)
    .sort((a, b) => b - a)
  const hhi = shares.reduce((s, v) => s + v * v, 0)
  const level: SpendConcentration["level"] =
    hhi < 1500 ? "low" : hhi < 2500 ? "moderate" : "high"
  return {
    hhi,
    level,
    topVendorSharePct: shares[0] ?? 0,
    top3SharePct: shares.slice(0, 3).reduce((s, v) => s + v, 0),
  }
}

// ─── Renewal risk ───────────────────────────────────────────────────

export interface RenewalRiskInput {
  daysRemaining: number
  compliancePct: number
  avgPriceVariancePct: number
  avgResponseTimeHours: number
  rebateUtilizationPct: number
  openIssues: number
}

export interface RenewalRisk {
  riskScore: number
  riskLevel: "low" | "medium" | "high"
}

/**
 * Composite renewal-risk score, 0-100, HIGHER MEANS MORE RISK.
 *
 * The weights sum to exactly 1.0 (0.2 + 0.25 + 0.2 + 0.15 + 0.1 + 0.1), which
 * is what keeps the output on a 0-100 scale and the `< 30` / `< 60` bands
 * meaningful. If you add a factor, rebalance the rest — weights summing to
 * more than 1 push scores past 100 and jam everything into "high".
 *
 * Each sub-score is normalised to 0-100 and oriented so that WORSE is HIGHER:
 *   daysToExpiration  step function — under 30d is maximal urgency
 *   compliance        inverted (100 − compliancePct)
 *   priceVariance     |variance| × 10, capped at 100, so ±10% saturates
 *   responsiveness    hours/24 × 100, capped, so a full day saturates
 *   rebateUtilization inverted (100 − utilizationPct)
 *   issues            count × 10, capped, so 10 open issues saturates
 *
 * The caps matter: without them a single extreme input (a 1,000-hour response
 * time) would dominate the composite and flatten every other signal.
 *
 * Inputs are trusted as already-normalised percentages. A `compliancePct`
 * above 100 or below 0 will push the composite outside 0-100.
 */
export function renewalRisk(input: RenewalRiskInput): RenewalRisk {
  const weights = {
    daysToExpiration: 0.2,
    compliance: 0.25,
    priceVariance: 0.2,
    responsiveness: 0.15,
    rebateUtilization: 0.1,
    issues: 0.1,
  }
  const scores = {
    daysToExpiration:
      input.daysRemaining < 30
        ? 100
        : input.daysRemaining < 60
          ? 75
          : input.daysRemaining < 90
            ? 50
            : 25,
    compliance: 100 - input.compliancePct,
    priceVariance: Math.min(Math.abs(input.avgPriceVariancePct) * 10, 100),
    responsiveness: Math.min((input.avgResponseTimeHours / 24) * 100, 100),
    rebateUtilization: 100 - input.rebateUtilizationPct,
    issues: Math.min(input.openIssues * 10, 100),
  }
  const riskScore =
    scores.daysToExpiration * weights.daysToExpiration +
    scores.compliance * weights.compliance +
    scores.priceVariance * weights.priceVariance +
    scores.responsiveness * weights.responsiveness +
    scores.rebateUtilization * weights.rebateUtilization +
    scores.issues * weights.issues
  const riskLevel: RenewalRisk["riskLevel"] =
    riskScore < 30 ? "low" : riskScore < 60 ? "medium" : "high"
  return { riskScore, riskLevel }
}
