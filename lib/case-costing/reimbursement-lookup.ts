/**
 * Case costing — reimbursement lookup.
 *
 * Pure function: given a case's CPT code + payor type, find the
 * reimbursement amount from a lookup table (e.g., PayorContract rows
 * pre-loaded by the server action). No DB; caller loads the rates.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md
 * (subsystem 1 — cases list page uses per-case reimbursement).
 */

export interface PayorCptRate {
  payorType: string
  cptCode: string
  /** Dollar amount reimbursed per case. */
  reimbursement: number
  /** Optional: when multiple rates exist for the same (payor, cpt), the
   *  most-recent effective date wins. */
  effectiveFrom?: Date | null
  effectiveTo?: Date | null
}

export interface CaseForReimbursement {
  primaryCptCode: string | null
  payorType: string | null
  dateOfSurgery: Date
}

export interface ReimbursementLookupResult {
  reimbursement: number
  source: "exact" | "cpt_only" | "payor_only" | "fallback" | "not_found"
  matchedRate: PayorCptRate | null
}

/**
 * Resolve a reimbursement for a single case. Search order:
 *   1. Exact (payorType, cptCode) match within effective window
 *   2. CPT-only match (any payor) within effective window
 *   3. payor-only match (any CPT) — rare; used as fallback
 *   4. Not found → 0 with source "not_found"
 */
export function lookupReimbursement(
  caseRec: CaseForReimbursement,
  rates: PayorCptRate[],
): ReimbursementLookupResult {
  const caseDate = caseRec.dateOfSurgery
  const inEffectiveWindow = (r: PayorCptRate): boolean => {
    if (r.effectiveFrom && caseDate < r.effectiveFrom) return false
    if (r.effectiveTo && caseDate > r.effectiveTo) return false
    return true
  }

  // Pass 1 — exact
  if (caseRec.primaryCptCode && caseRec.payorType) {
    const exact = rates.filter(
      (r) =>
        r.cptCode === caseRec.primaryCptCode &&
        r.payorType === caseRec.payorType &&
        inEffectiveWindow(r),
    )
    if (exact.length > 0) {
      const chosen = pickMostRecent(exact)
      return {
        reimbursement: chosen.reimbursement,
        source: "exact",
        matchedRate: chosen,
      }
    }
  }

  // Pass 2 — CPT only
  if (caseRec.primaryCptCode) {
    const cptOnly = rates.filter(
      (r) => r.cptCode === caseRec.primaryCptCode && inEffectiveWindow(r),
    )
    if (cptOnly.length > 0) {
      const chosen = pickMostRecent(cptOnly)
      return {
        reimbursement: chosen.reimbursement,
        source: "cpt_only",
        matchedRate: chosen,
      }
    }
  }

  // Pass 3 — payor only
  if (caseRec.payorType) {
    const payorOnly = rates.filter(
      (r) => r.payorType === caseRec.payorType && inEffectiveWindow(r),
    )
    if (payorOnly.length > 0) {
      const chosen = pickMostRecent(payorOnly)
      return {
        reimbursement: chosen.reimbursement,
        source: "payor_only",
        matchedRate: chosen,
      }
    }
  }

  return {
    reimbursement: 0,
    source: "not_found",
    matchedRate: null,
  }
}

/** Prefer the rate with the latest effectiveFrom; null effectiveFrom sorts oldest. */
function pickMostRecent(rates: PayorCptRate[]): PayorCptRate {
  return [...rates].sort((a, b) => {
    const ams = a.effectiveFrom ? a.effectiveFrom.getTime() : 0
    const bms = b.effectiveFrom ? b.effectiveFrom.getTime() : 0
    return bms - ams
  })[0]!
}

/**
 * Bulk variant — resolve reimbursement for an array of cases. Caller
 * passes in the rate table once; this iterates and returns a map.
 */
export function bulkLookupReimbursement(
  cases: Array<CaseForReimbursement & { id: string }>,
  rates: PayorCptRate[],
): Record<string, ReimbursementLookupResult> {
  const result: Record<string, ReimbursementLookupResult> = {}
  for (const c of cases) {
    result[c.id] = lookupReimbursement(c, rates)
  }
  return result
}
