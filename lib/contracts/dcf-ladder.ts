/**
 * Builds the spend-dollar rebate ladder a DCF projection runs against.
 *
 * Deliberately directive-free and Prisma-free so it serves both an approved
 * Contract (ContractTerm/ContractTier rows) and a PendingContract (the same
 * ladder carried as JSON, read out by `extractPendingTerms`). The inputs are
 * plain objects; Decimal columns arrive as anything `Number()` accepts.
 */

import { toEngineRebateUnits } from "@/lib/rebates/calculate"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"
import {
  annualizePeriodCap,
  type AccrualTier,
} from "@/lib/contracts/rebate-accrual-schedule"
import type { RebateType } from "@/lib/generated/prisma/enums"

/** Anything a Prisma Decimal, a JSON number, or a numeric string can be. */
type Numeric = number | string | { toString(): string } | null | undefined

export interface LadderTierInput {
  spendMin: Numeric
  spendMax: Numeric
  rebateValue: Numeric
  rebateType: string
}

export interface LadderTermInput {
  termName?: string | null
  termType: string
  rebateMethod?: string | null
  boundaryRule?: string | null
  evaluationPeriod?: string | null
  spendBaseline?: Numeric
  growthOnly?: boolean | null
  periodCap?: Numeric
  tiers: LadderTierInput[]
}

/**
 * The contract's ladder in ENGINE units — percent in `rebateValue`, flat
 * dollars in `fixedRebateAmount`, mapped by `toEngineRebateUnits`.
 *
 * `hasSpendDollarTierLadder` gates the THRESHOLD unit; the rebate VALUE unit is
 * `toEngineRebateUnits`' job.
 */
export interface ContractRebateLadder {
  tiers: AccrualTier[]
  rebateMethod: "cumulative" | "marginal"
  boundaryRule: "exclusive" | "inclusive"
  termName: string | null
  /** Annual dollars; only reduces the rebate base when `growthOnly`. */
  spendBaseline: number | null
  growthOnly: boolean
  /** `periodCap` converted to dollars per projection year. */
  annualSpendCap: number | null
}

/** Contract term length in years; the divisor for the total-value spend
 *  fallback and the spread for a `lifetime` period cap. */
export function contractTermYears(
  effectiveDate: Date | string | null | undefined,
  expirationDate: Date | string | null | undefined,
): number {
  if (!effectiveDate || !expirationDate) return 1
  const start = new Date(effectiveDate).getTime()
  const end = new Date(expirationDate).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1
  return (end - start) / (1000 * 60 * 60 * 24 * 365.25)
}

/** Year-1 spend basis: the stated annual value, else total ÷ term length. */
export function resolveBaseAnnualSpend(
  annualValue: Numeric,
  totalValue: Numeric,
  termYears: number,
): number {
  const annual = Number(annualValue)
  if (annual > 0) return annual
  const total = Number(totalValue)
  return termYears > 0 && total > 0 ? total / termYears : 0
}

/** First term carrying a real, payable spend-dollar ladder wins. */
export function buildContractRebateLadder(
  terms: LadderTermInput[],
  termYears: number,
): ContractRebateLadder | null {
  for (const term of terms) {
    const shaped = {
      termType: term.termType,
      tiers: term.tiers.map((t) => ({ rebateValue: t.rebateValue })),
    }
    if (!hasSpendDollarTierLadder(shaped)) continue

    const tiers: AccrualTier[] = term.tiers.map((t) => {
      const units = toEngineRebateUnits(
        t.rebateValue ?? 0,
        t.rebateType as RebateType,
      )
      return {
        spendMin: Number(t.spendMin),
        spendMax: t.spendMax == null ? null : Number(t.spendMax),
        rebateValue: units.rebateValue,
        fixedRebateAmount: units.fixedRebateAmount,
      }
    })

    // fixed_rebate_per_unit / per_procedure_rebate earn units × rate and pay
    // nothing on a spend-driven projection, so a term made only of those maps
    // to an all-zero ladder. Fall through rather than render badges earning $0.
    const payable = tiers.some(
      (t) => t.rebateValue > 0 || (t.fixedRebateAmount ?? 0) > 0,
    )
    if (!payable) continue

    return {
      tiers,
      rebateMethod: term.rebateMethod === "marginal" ? "marginal" : "cumulative",
      boundaryRule: term.boundaryRule === "inclusive" ? "inclusive" : "exclusive",
      termName: term.termName ?? null,
      // `== null`, not `===`: Decimal? columns can arrive as undefined, which
      // Number() turns into NaN.
      spendBaseline: term.spendBaseline == null ? null : Number(term.spendBaseline),
      growthOnly: term.growthOnly ?? false,
      annualSpendCap: annualizePeriodCap(
        term.periodCap == null ? null : Number(term.periodCap),
        term.evaluationPeriod ?? "annual",
        termYears,
      ),
    }
  }
  return null
}
