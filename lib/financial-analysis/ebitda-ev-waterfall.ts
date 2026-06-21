/**
 * EBITDA & EV Waterfall + Enterprise Value Impact Predictor — Charles AI
 * Prospective Impact Engine, features #4 and #5 (2026-06-21).
 *
 * Pure function. Builds the bridge from current EBITDA to future EBITDA via
 * the named value levers, then translates the EBITDA delta into enterprise
 * value at a chosen multiple:
 *
 *   Current EBITDA
 *     + Implant Savings
 *     + Rebate Value
 *     + Growth Impact
 *     + Labor Savings
 *     + Throughput Impact
 *   = Future EBITDA
 *
 *   Current EV  →  Future EV   (each = EBITDA × multiple)
 *   Incremental EV = ΔEBITDA × multiple
 *
 * Example (Charles): $5.0M EBITDA, $0.8M improvement, 12× →
 *   Current EV $60M → Future EV $69.6M; "creates ≈ $9.6M of enterprise value."
 */

export interface EbitdaWaterfallLevers {
  currentEbitda: number
  implantSavings: number
  rebateValue: number
  growthImpact: number
  laborSavings: number
  throughputImpact: number
}

export interface WaterfallStep {
  key: string
  label: string
  /** Signed contribution to EBITDA. */
  value: number
  /** Running EBITDA total after this step. */
  cumulative: number
  /** "base" | "delta" | "total" — drives bar styling. */
  kind: "base" | "delta" | "total"
}

export interface EvImpactPrediction {
  multiple: number
  currentEv: number
  futureEv: number
  incrementalEv: number
  insight: string
}

export interface EbitdaEvWaterfall {
  steps: WaterfallStep[]
  currentEbitda: number
  futureEbitda: number
  totalEbitdaImprovement: number
  ev: EvImpactPrediction
}

export function computeEbitdaEvWaterfall(
  levers: EbitdaWaterfallLevers,
  evMultiple: number,
): EbitdaEvWaterfall {
  const deltas: Array<{ key: string; label: string; value: number }> = [
    { key: "implantSavings", label: "Implant Savings", value: levers.implantSavings },
    { key: "rebateValue", label: "Rebate Value", value: levers.rebateValue },
    { key: "growthImpact", label: "Growth Impact", value: levers.growthImpact },
    { key: "laborSavings", label: "Labor Savings", value: levers.laborSavings },
    {
      key: "throughputImpact",
      label: "Throughput Impact",
      value: levers.throughputImpact,
    },
  ]

  const steps: WaterfallStep[] = []
  let cumulative = levers.currentEbitda
  steps.push({
    key: "currentEbitda",
    label: "Current EBITDA",
    value: levers.currentEbitda,
    cumulative,
    kind: "base",
  })
  for (const d of deltas) {
    cumulative += d.value
    steps.push({ ...d, cumulative, kind: "delta" })
  }
  const futureEbitda = cumulative
  steps.push({
    key: "futureEbitda",
    label: "Future EBITDA",
    value: futureEbitda,
    cumulative: futureEbitda,
    kind: "total",
  })

  const totalEbitdaImprovement = futureEbitda - levers.currentEbitda
  const currentEv = levers.currentEbitda * evMultiple
  const futureEv = futureEbitda * evMultiple
  const incrementalEv = futureEv - currentEv

  return {
    steps,
    currentEbitda: levers.currentEbitda,
    futureEbitda,
    totalEbitdaImprovement,
    ev: {
      multiple: evMultiple,
      currentEv,
      futureEv,
      incrementalEv,
      insight: `Proposed agreement creates approximately ${fmtUsdM(
        incrementalEv,
      )} of enterprise value.`,
    },
  }
}

function fmtUsdM(n: number): string {
  return `$${(n / 1_000_000).toFixed(1)}M`
}
