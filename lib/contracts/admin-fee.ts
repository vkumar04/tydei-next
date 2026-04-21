/**
 * GPO admin fee — net rebate math.
 *
 * Roadmap track 4 (2026-04-20): most GPO contracts (Vizient, Premier,
 * HealthTrust) skim an admin fee (typically 2–3%) off the top of the
 * rebate the vendor pays. The facility's NET rebate is
 * `gross − adminFee`, and that's the number that matters for budget
 * planning. Tydei today models gross rebate only; this helper is the
 * single place that computes the net.
 *
 * Pure function, framework-free. Zero DB.
 *
 * Convention: `adminFeePercent` is a FRACTION (0.03 = 3%) matching
 * `ContractTerm.adminFeePercent` on the Prisma row. Null / undefined /
 * zero = no admin fee; the net equals the gross.
 *
 * Sign convention: all three values (gross, adminFee, net) are ≥ 0 for
 * positive gross input. Negative gross (chargebacks / reversals) is
 * passed through unchanged — admin fee doesn't recalculate on negative
 * rebate corrections, that's a separate contract clause that tydei
 * will model when asked.
 */

export interface NetRebateInput {
  /** Gross rebate from the rebate engine. */
  gross: number
  /**
   * Admin fee rate as a fraction (0.03 = 3%). Null / undefined / zero
   * treated as "no admin fee". Negative rates are clamped to zero —
   * a negative admin fee would imply the GPO paying the facility
   * (nonsense; if a rebate-sharing agreement exists, model it as a
   * separate contract.).
   */
  adminFeePercent?: number | null | undefined
}

export interface NetRebateResult {
  gross: number
  adminFee: number
  net: number
  /** The fraction that was applied, after clamping. 0 when no fee. */
  appliedRate: number
}

export function computeNetRebate(input: NetRebateInput): NetRebateResult {
  const gross = Number.isFinite(input.gross) ? input.gross : 0
  const rawRate = input.adminFeePercent
  if (rawRate == null) {
    return { gross, adminFee: 0, net: gross, appliedRate: 0 }
  }
  const rate = Math.max(0, Number(rawRate))
  if (rate === 0) {
    return { gross, adminFee: 0, net: gross, appliedRate: 0 }
  }
  // Pass negative gross through unchanged — chargeback semantics
  // deliberately don't net-out the admin fee.
  if (gross < 0) {
    return { gross, adminFee: 0, net: gross, appliedRate: rate }
  }
  const adminFee = gross * rate
  return {
    gross,
    adminFee,
    net: gross - adminFee,
    appliedRate: rate,
  }
}

/**
 * Bulk helper: sum `net` across an array of rebate rows, each with an
 * optional admin-fee rate (usually inherited from the row's
 * ContractTerm). Used by display-side reducers that need the facility-
 * realized total.
 */
export function sumNetRebate(
  rows: readonly NetRebateInput[],
): NetRebateResult {
  let gross = 0
  let adminFee = 0
  for (const r of rows) {
    const res = computeNetRebate(r)
    gross += res.gross
    adminFee += res.adminFee
  }
  return {
    gross,
    adminFee,
    net: gross - adminFee,
    appliedRate: gross > 0 ? adminFee / gross : 0,
  }
}
