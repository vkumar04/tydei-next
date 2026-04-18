/**
 * Case costing — pure case-list filter helpers.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md
 * Subsystem 1 — Cases list tab (canonical §7 filters).
 *
 * Pure functions — no DB, no side effects.
 */

export interface CaseForFilter {
  id: string
  caseNumber: string
  surgeonName: string | null
  primaryCptCode: string | null
  dateOfSurgery: Date
  patientType?: "inpatient" | "outpatient" | null
  payorType?: string | null
  totalSpend: number
  totalReimbursement: number
  facilityId: string
}

export interface CaseFilters {
  dateFrom?: Date | null
  dateTo?: Date | null
  /** Surgeon names to include (OR within field). */
  surgeons?: string[]
  cptCodes?: string[]
  patientTypes?: Array<"inpatient" | "outpatient">
  payorTypes?: string[]
  facilityIds?: string[]
  /** Case-insensitive trimmed substring match on caseNumber + surgeon + CPT. */
  search?: string
}

/**
 * Filter cases by composable criteria.
 *
 * Semantics:
 *   - Fields AND together.
 *   - Array fields OR within themselves.
 *   - Empty/undefined filter field → not applied.
 *   - dateFrom/dateTo are inclusive on both ends.
 */
export function filterCases(
  cases: CaseForFilter[],
  filters: CaseFilters,
): CaseForFilter[] {
  const hasDateFrom = filters.dateFrom instanceof Date
  const hasDateTo = filters.dateTo instanceof Date
  const dateFromMs = hasDateFrom ? (filters.dateFrom as Date).getTime() : 0
  const dateToMs = hasDateTo ? (filters.dateTo as Date).getTime() : 0

  const surgeonSet =
    filters.surgeons && filters.surgeons.length > 0
      ? new Set(filters.surgeons)
      : null
  const cptSet =
    filters.cptCodes && filters.cptCodes.length > 0
      ? new Set(filters.cptCodes)
      : null
  const patientTypeSet =
    filters.patientTypes && filters.patientTypes.length > 0
      ? new Set(filters.patientTypes)
      : null
  const payorTypeSet =
    filters.payorTypes && filters.payorTypes.length > 0
      ? new Set(filters.payorTypes)
      : null
  const facilitySet =
    filters.facilityIds && filters.facilityIds.length > 0
      ? new Set(filters.facilityIds)
      : null

  const searchTrimmed =
    typeof filters.search === "string" ? filters.search.trim() : ""
  const search = searchTrimmed.length > 0 ? searchTrimmed.toLowerCase() : null

  return cases.filter((c) => {
    if (hasDateFrom && c.dateOfSurgery.getTime() < dateFromMs) return false
    if (hasDateTo && c.dateOfSurgery.getTime() > dateToMs) return false

    if (surgeonSet && (c.surgeonName === null || !surgeonSet.has(c.surgeonName)))
      return false

    if (
      cptSet &&
      (c.primaryCptCode === null || !cptSet.has(c.primaryCptCode))
    )
      return false

    if (patientTypeSet) {
      if (c.patientType === null || c.patientType === undefined) return false
      if (!patientTypeSet.has(c.patientType)) return false
    }

    if (payorTypeSet) {
      if (c.payorType === null || c.payorType === undefined) return false
      if (!payorTypeSet.has(c.payorType)) return false
    }

    if (facilitySet && !facilitySet.has(c.facilityId)) return false

    if (search) {
      const haystack = [
        c.caseNumber,
        c.surgeonName ?? "",
        c.primaryCptCode ?? "",
      ]
        .join(" ")
        .toLowerCase()
      if (!haystack.includes(search)) return false
    }

    return true
  })
}
