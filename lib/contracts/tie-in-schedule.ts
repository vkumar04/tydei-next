/**
 * Tie-in amortization-schedule helper — Prisma-boundary caller.
 *
 * The engine in `lib/rebates/engine/amortization.ts` takes a raw
 * `capitalCost` and knows nothing about `downPayment`. Wave B (tie-in
 * parity) captures `downPayment` on ContractTerm so the opening balance
 * on the amortization schedule must be `capitalCost - downPayment`.
 *
 * This helper is the single place we pre-compute that effective
 * principal before handing it to the pure engine. Wave A's contract-
 * detail schedule card + any future server action that persists
 * ContractAmortizationSchedule rows should both call this helper rather
 * than invoking `buildTieInAmortizationSchedule` directly with
 * `term.capitalCost`.
 */
import {
  buildTieInAmortizationSchedule,
  type AmortizationScheduleConfig,
} from "@/lib/rebates/engine/amortization"
import type { AmortizationEntry } from "@/lib/rebates/engine/types"

export interface TermScheduleInput {
  capitalCost: number | null | undefined
  downPayment?: number | null
  interestRate: number | null | undefined
  termMonths: number | null | undefined
  /**
   * Matches the engine's cadence union. `ContractTerm.paymentCadence`
   * defaults to `monthly` in the schema; callers convert Prisma's enum
   * to a plain string.
   */
  paymentCadence?: AmortizationScheduleConfig["period"] | null
}

/**
 * Build a tie-in amortization schedule from a ContractTerm-shaped input.
 * Returns [] when required fields are missing / zero — mirroring the
 * engine's own "no capital, no schedule" contract.
 */
export function buildScheduleForTerm(
  input: TermScheduleInput,
): AmortizationEntry[] {
  const capitalCost = Number(input.capitalCost ?? 0)
  const downPayment = Number(input.downPayment ?? 0)
  const interestRate = Number(input.interestRate ?? 0)
  const termMonths = Number(input.termMonths ?? 0)
  const period = input.paymentCadence ?? "monthly"

  const effectivePrincipal = Math.max(0, capitalCost - downPayment)

  return buildTieInAmortizationSchedule({
    capitalCost: effectivePrincipal,
    interestRate,
    termMonths,
    period,
  })
}
