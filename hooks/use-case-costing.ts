"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
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
import type { CaseInput, CaseSupplyInput } from "@/lib/validators/cases"
import { toast } from "sonner"

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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { facilityId: string; cases: CaseInput[] }) =>
      importCases(input),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.all })
      toast.success(
        `Imported ${result.imported} cases (${result.errors} errors)`
      )
    },
    onError: (err) => toast.error(err.message || "Failed to import cases"),
  })
}

export function useDeleteAllCases() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => deleteAllCases(),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.all })
      toast.success(`Cleared ${result.deleted} prior case${result.deleted === 1 ? "" : "s"}`)
    },
    onError: (err) => toast.error(err.message || "Failed to clear cases"),
  })
}

export function useImportCaseSupplies() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { caseId: string; supplies: CaseSupplyInput[] }) =>
      importCaseSupplies(input),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.all })
      toast.success(
        `Imported ${result.imported} supplies (${result.matched} on-contract)`
      )
    },
    onError: (err) => toast.error(err.message || "Failed to import supplies"),
  })
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
