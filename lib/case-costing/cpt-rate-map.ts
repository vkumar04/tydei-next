/**
 * Canonical CPT → payor-rate map builder for case-costing reimbursement
 * backfill.
 *
 * Why this exists (2026-06 case-costing audit H5): the same ~30-line
 * "build a CPT rate map from PayorContract.cptRates JSON" block was
 * copy-pasted into `getCases`, `getFacilityAveragesForFacility`, and
 * `calculatePayorMargins`, while `getCaseCostingReportData` used the raw
 * stored `Case.totalReimbursement` (0 in most prod states) — so the
 * report header's "Avg Margin" contradicted the per-case tables beside
 * it. This module is the ONE place the rate-map filter lives, mirroring
 * the canonical-reducer policy in CLAUDE.md.
 *
 * Pure functions — no Prisma imports. Callers pass the `cptRates` JSON
 * straight off the PayorContract rows.
 *
 * Shape tolerance: the seeded payor-contract JSON uses
 * `{cpt, rate, description}`, but a future migration to Prisma relations
 * may use `{cptCode, rate}`. Accept both so either seed format lights up
 * reimbursement.
 */

export interface PayorContractRatesRow {
  /** `PayorContract.cptRates` JSON column, passed through untouched. */
  cptRates: unknown
}

type RawCptRate = { cpt?: string; cptCode?: string; rate?: unknown }

/**
 * Fold one or more payor contracts' `cptRates` JSON into a single
 * CPT → best-rate map. When multiple contracts (or duplicate rows)
 * carry the same CPT, the HIGHEST rate wins — every pre-extraction
 * call site used that rule so a case's expected reimbursement is the
 * best available payor rate.
 */
export function buildCptRateMap(
  payorContracts: PayorContractRatesRow[],
): Map<string, number> {
  const cptRateMap = new Map<string, number>()
  for (const pc of payorContracts) {
    const rates = Array.isArray(pc.cptRates)
      ? (pc.cptRates as RawCptRate[])
      : []
    for (const r of rates) {
      const code = r.cptCode ?? r.cpt
      if (!code || typeof r.rate !== "number") continue
      const existing = cptRateMap.get(code)
      if (existing === undefined || r.rate > existing) {
        cptRateMap.set(code, r.rate)
      }
    }
  }
  return cptRateMap
}

export interface CaseForReimbursement {
  /** Stored `Case.totalReimbursement` (already Number()-coerced). */
  storedReimbursement: number
  primaryCptCode: string | null
  /** CPT codes from the case's procedure rows (may be empty). */
  procedureCptCodes: Array<string | null>
}

/**
 * Effective reimbursement for a case: the stored value when it's
 * explicitly set (> 0), otherwise the best CPT-rate estimate across
 * (a) the primary CPT and (b) any procedure CPT — some cases import
 * with procedure rows but no primary flag set.
 */
export function resolveCaseReimbursement(
  c: CaseForReimbursement,
  cptRateMap: Map<string, number>,
): number {
  if (c.storedReimbursement > 0) return c.storedReimbursement
  let computed = 0
  if (c.primaryCptCode) {
    computed = cptRateMap.get(c.primaryCptCode) ?? 0
  }
  for (const code of c.procedureCptCodes) {
    if (!code) continue
    const rate = cptRateMap.get(code)
    if (rate !== undefined && rate > computed) computed = rate
  }
  return computed
}
