"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getCases,
  getCase,
  importCases,
  importCaseSupplies,
  getSurgeonScorecards,
  getCPTAnalysis,
  compareSurgeons,
  getCaseCostingReportData,
  deleteAllCases,
} from "@/lib/actions/cases"
import {
  getFacilityPayorContracts,
  calculatePayorMargins,
} from "@/lib/actions/payor-contracts"
import { getTrueMarginReport } from "@/lib/actions/case-costing/true-margin"
import { getSurgeonRebateContribution } from "@/lib/actions/case-costing/surgeon-rebate-contribution"
import { getSurgeonVendorSpend } from "@/lib/actions/case-costing/surgeon-vendor-spend"
import type { CaseInput, CaseSupplyInput } from "@/lib/validators/cases"

export function useCases(facilityId: string, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.cases.list(facilityId, filters),
    queryFn: () => getCases({ facilityId, ...filters }),
  })
}

export function useCaseDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.cases.detail(id),
    queryFn: () => getCase(id),
    enabled: !!id,
  })
}

export function useImportCases() {
  return useToastMutation(
    (input: { facilityId: string; cases: CaseInput[] }) => importCases(input),
    {
      invalidate: [queryKeys.cases.all],
      success: (result) =>
        `Imported ${result.imported} cases (${result.errors} errors)`,
      error: "Failed to import cases",
    },
  )
}

export function useDeleteAllCases() {
  return useToastMutation(() => deleteAllCases(), {
    invalidate: [queryKeys.cases.all],
    success: (result) =>
      `Cleared ${result.deleted} prior case${result.deleted === 1 ? "" : "s"}`,
    error: "Failed to clear cases",
  })
}

export function useImportCaseSupplies() {
  return useToastMutation(
    (input: { caseId: string; supplies: CaseSupplyInput[] }) =>
      importCaseSupplies(input),
    {
      invalidate: [queryKeys.cases.all],
      success: (result) =>
        `Imported ${result.imported} supplies (${result.matched} on-contract)`,
      error: "Failed to import supplies",
    },
  )
}

export function useSurgeonScorecards(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.cases.surgeonScorecards(facilityId),
    queryFn: () => getSurgeonScorecards(facilityId),
  })
}

export function useCPTAnalysis(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.cases.cptAnalysis(facilityId),
    queryFn: () => getCPTAnalysis(facilityId),
  })
}

export function useSurgeonComparison(
  facilityId: string,
  surgeonNames: string[],
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.cases.surgeonComparison(facilityId, surgeonNames),
    queryFn: () => compareSurgeons({ facilityId, surgeonNames }),
    enabled: enabled && surgeonNames.length >= 2,
  })
}

export function useCaseCostingReport(
  facilityId: string,
  filters?: Record<string, unknown>
) {
  return useQuery({
    queryKey: queryKeys.cases.reportData(facilityId, filters),
    queryFn: () => getCaseCostingReportData({ facilityId, ...filters }),
  })
}

/**
 * Per-surgeon rebate contribution — attributes each contract's REAL
 * earned-rebate rate (earned ÷ on-contract COG spend) to the surgeons
 * who used that contract's products. Replaces the legacy flat-3%
 * estimate. Date window matches the cases query.
 */
export function useSurgeonRebateContribution(
  facilityId: string,
  filters?: Record<string, unknown>,
) {
  return useQuery({
    queryKey: queryKeys.cases.surgeonRebateContribution(facilityId, filters),
    queryFn: () =>
      getSurgeonRebateContribution({ facilityId, ...filters }),
  })
}

/**
 * Surgeon × Vendor spend (Charles 2026-06-18) — per surgeon, spend with each
 * vendor from case supplies, with on/off-contract compliance. Date window
 * matches the cases query.
 */
export function useSurgeonVendorSpend(
  facilityId: string,
  filters?: Record<string, unknown>,
) {
  return useQuery({
    queryKey: queryKeys.cases.surgeonVendorSpend(facilityId, filters),
    queryFn: () => getSurgeonVendorSpend({ facilityId, ...filters }),
  })
}

export function usePayorContracts() {
  return useQuery({
    queryKey: queryKeys.cases.payorContracts(),
    queryFn: () => getFacilityPayorContracts(),
  })
}

export function usePayorMargins(payorContractId: string | null) {
  return useQuery({
    queryKey: queryKeys.cases.payorMargins(payorContractId ?? ""),
    queryFn: () => calculatePayorMargins({ payorContractId: payorContractId! }),
    enabled: !!payorContractId,
  })
}

/**
 * True-margin report — per-procedure margin with proportional rebate
 * allocation per the canonical `allocateRebatesToProcedures` helper.
 */
export function useTrueMarginReport(
  facilityId: string,
  periodStart: string,
  periodEnd: string,
) {
  return useQuery({
    queryKey: queryKeys.cases.trueMargin(facilityId, periodStart, periodEnd),
    queryFn: () =>
      getTrueMarginReport({ facilityId, periodStart, periodEnd }),
    enabled: !!facilityId && !!periodStart && !!periodEnd,
  })
}
