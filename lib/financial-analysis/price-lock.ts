/**
 * Price-lock opportunity cost.
 *
 * When a facility signs a multi-year price-lock contract, the economic
 * cost of the lock is the difference between what the facility is
 * paying (flat annualSpend every year) and what the market would have
 * cost had prices been allowed to decline year over year. This module
 * models that opportunity cost under a simple geometric-decline model.
 */

export interface PriceLockInput {
  /** Contract annual spend in dollars, held flat for the contract term. */
  annualSpend: number
  /** Number of contract years. */
  years: number
  /** Market decline rate as a decimal (0.02 = 2%/year). */
  marketDeclineRate: number
}

export interface PriceLockResult {
  /** Opportunity cost incurred in year t (0-indexed). */
  yearlyCost: number[]
  /** Sum of yearlyCost[] = total opportunity cost over the term. */
  totalOpportunityCost: number
}

/**
 * Compute price-lock opportunity cost per year and in total.
 *
 * Model: at year t (1-indexed, so first contract year is t=1) the market
 * price would have fallen to annualSpend × (1 − marketDeclineRate)^t.
 * The facility still pays annualSpend, so the overpayment — the
 * opportunity cost — is:
 *
 *   yearlyCost[t-1] = annualSpend − annualSpend × (1 − marketDeclineRate)^t
 *                   = annualSpend × (1 − (1 − marketDeclineRate)^t)
 *
 * The array is 0-indexed; index 0 corresponds to contract year 1.
 *
 * Edge cases:
 *   - marketDeclineRate = 0 → every yearly cost is 0, total is 0.
 *   - years = 0             → empty array and zero total.
 */
export function computePriceLockCost(input: PriceLockInput): PriceLockResult {
  const { annualSpend, years, marketDeclineRate } = input
  const yearlyCost: number[] = []
  let total = 0

  for (let i = 0; i < years; i++) {
    const marketPrice = annualSpend * Math.pow(1 - marketDeclineRate, i + 1)
    const cost = annualSpend - marketPrice
    yearlyCost.push(cost)
    total += cost
  }

  return { yearlyCost, totalOpportunityCost: total }
}
