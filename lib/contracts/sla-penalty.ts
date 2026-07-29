/**
 * Service-contract SLA penalty calculation.
 *
 * Migrated out of `lib/v0-spec/` on 2026-07-29 with ZERO behaviour change.
 * See `lib/contracts/tie-in-bundle-math.ts` for why `v0-spec` went away.
 */

export interface SlaPenaltyInput {
  actualResponseHours: number
  slaResponseHours: number
  /** Charged per hour BEYOND the SLA, not per hour of the whole response. */
  hourlyPenaltyRate: number
  actualUptimePct: number
  slaUptimePct: number
  annualFee: number
}

export interface SlaPenaltyResult {
  responsePenalty: number
  uptimePenalty: number
  totalPenalty: number
}

/**
 * Two independent penalties, summed:
 *
 *   response: (actualHours − slaHours) × hourlyPenaltyRate, only when late
 *   uptime:   annualFee × (slaUptimePct − actualUptimePct) / 100, only when short
 *
 * Both are one-sided by design — beating the SLA earns nothing, it does not
 * generate a negative penalty that offsets the other component. That is why
 * each branch guards with a comparison instead of relying on the subtraction's
 * sign; without the guards, a fast response would credit back against an
 * uptime miss and understate the total.
 *
 * Uptime percentages are on a 0-100 scale, so the `/ 100` converts the
 * shortfall to a fraction of the annual fee. Passing fractions (0.995 for
 * 99.5%) instead would under-charge by 100×.
 *
 * Returns positive numbers meaning "vendor owes"; the caller decides the sign
 * convention for display.
 */
export function serviceSlaPenalty(input: SlaPenaltyInput): SlaPenaltyResult {
  const responsePenalty =
    input.actualResponseHours > input.slaResponseHours
      ? (input.actualResponseHours - input.slaResponseHours) *
        input.hourlyPenaltyRate
      : 0
  const uptimePenalty =
    input.actualUptimePct < input.slaUptimePct
      ? input.annualFee * ((input.slaUptimePct - input.actualUptimePct) / 100)
      : 0
  return {
    responsePenalty,
    uptimePenalty,
    totalPenalty: responsePenalty + uptimePenalty,
  }
}
