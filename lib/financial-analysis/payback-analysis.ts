/**
 * Payback Analysis — Charles AI Prospective Impact Engine, feature #3
 * (2026-06-21).
 *
 * Pure function. Models the payback period of a prospective capital /
 * robotics / SPD / navigation / technology investment under three benefit
 * scenarios:
 *
 *   Scenario      Payback
 *   Conservative  4.2 yrs
 *   Expected      2.8 yrs
 *   Aggressive    1.9 yrs
 *
 * Conservative discounts the expected annual benefit; aggressive inflates it.
 * Payback = investment ÷ scenario annual benefit.
 */

export interface PaybackInput {
  /** Total upfront investment ($). */
  investmentCost: number
  /** Expected annual benefit ($) — savings + incremental contribution. */
  expectedAnnualBenefit: number
  /** Conservative benefit multiplier (default 0.667 → ~1.5× longer payback). */
  conservativeFactor?: number
  /** Aggressive benefit multiplier (default 1.47 → ~1.5× faster payback). */
  aggressiveFactor?: number
}

export type PaybackScenarioName = "conservative" | "expected" | "aggressive"

export interface PaybackScenario {
  scenario: PaybackScenarioName
  annualBenefit: number
  /** Years to recoup the investment. null = never (non-positive benefit). */
  paybackYears: number | null
}

export interface PaybackAnalysisResult {
  investmentCost: number
  scenarios: PaybackScenario[]
}

export function computePaybackAnalysis(
  input: PaybackInput,
): PaybackAnalysisResult {
  const conservativeFactor = input.conservativeFactor ?? 0.667
  const aggressiveFactor = input.aggressiveFactor ?? 1.47

  const make = (
    scenario: PaybackScenarioName,
    annualBenefit: number,
  ): PaybackScenario => ({
    scenario,
    annualBenefit,
    paybackYears:
      annualBenefit > 0
        ? Math.round((input.investmentCost / annualBenefit) * 10) / 10
        : null,
  })

  return {
    investmentCost: input.investmentCost,
    scenarios: [
      make("conservative", input.expectedAnnualBenefit * conservativeFactor),
      make("expected", input.expectedAnnualBenefit),
      make("aggressive", input.expectedAnnualBenefit * aggressiveFactor),
    ],
  }
}
