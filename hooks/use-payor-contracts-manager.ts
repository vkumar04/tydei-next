"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  createFacilityPayorContract,
  updateFacilityPayorContract,
  deleteFacilityPayorContract,
  importPayorContractRates,
} from "@/lib/actions/facility-payor-contracts"
import type { CreatePayorContractInput, UpdatePayorContractInput } from "@/lib/validators/payor-contracts"
import { toast } from "sonner"

export function useCreatePayorContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePayorContractInput) => createFacilityPayorContract(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorContracts() })
      // bugs.rtfd 2026-06-14: also refresh the Payor Contract Margin dropdown
      // (distinct query key) so a newly added/removed contract appears without
      // a page reload.
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorMarginOptions() })
      // best-practices sweep 2026-06-17: refresh the Payor Contract Margin
      // card's summary tiles (Est. Reimbursement / CPT Matched / Total
      // Margin) — nothing was invalidating that key before, so a rate
      // import left the tiles stale until reload.
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorMarginSummaryBase })
      toast.success("Payor contract created")
    },
    onError: (err) => toast.error(err.message || "Failed to create payor contract"),
  })
}

export function useUpdatePayorContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePayorContractInput }) =>
      updateFacilityPayorContract(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorContracts() })
      // bugs.rtfd 2026-06-14: also refresh the Payor Contract Margin dropdown
      // (distinct query key) so a newly added/removed contract appears without
      // a page reload.
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorMarginOptions() })
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorMarginSummaryBase })
      toast.success("Payor contract updated")
    },
    onError: (err) => toast.error(err.message || "Failed to update payor contract"),
  })
}

export function useDeletePayorContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteFacilityPayorContract(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorContracts() })
      // bugs.rtfd 2026-06-14: also refresh the Payor Contract Margin dropdown
      // (distinct query key) so a newly added/removed contract appears without
      // a page reload.
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorMarginOptions() })
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorMarginSummaryBase })
      toast.success("Payor contract deleted")
    },
    onError: (err) => toast.error(err.message || "Failed to delete payor contract"),
  })
}

export function useImportPayorRates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ contractId, rates }: { contractId: string; rates: { cptCode: string; description?: string; rate: number }[] }) =>
      importPayorContractRates(contractId, rates),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorContracts() })
      // bugs.rtfd 2026-06-14: also refresh the Payor Contract Margin dropdown
      // (distinct query key) so a newly added/removed contract appears without
      // a page reload.
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorMarginOptions() })
      qc.invalidateQueries({ queryKey: queryKeys.cases.payorMarginSummaryBase })
      toast.success(`Imported ${result.imported} CPT rates (${result.total} total)`)
    },
    onError: (err) => toast.error(err.message || "Failed to import rates"),
  })
}
