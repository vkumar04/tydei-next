"use client"

import { queryKeys } from "@/lib/query-keys"
import {
  createFacilityPayorContract,
  updateFacilityPayorContract,
  deleteFacilityPayorContract,
  importPayorContractRates,
} from "@/lib/actions/facility-payor-contracts"
import type { CreatePayorContractInput, UpdatePayorContractInput } from "@/lib/validators/payor-contracts"
import { useToastMutation } from "@/hooks/use-toast-mutation"

// A payor-contract mutation refreshes the Payor Contracts list
// (`cases.payorContracts`), the Payor Contract Margin dropdown
// (`cases.payorMarginOptions`, distinct key — bugs.rtfd 2026-06-14), and the
// Margin card's summary tiles (`cases.payorMarginSummaryBase`, best-practices
// sweep 2026-06-17 — nothing was invalidating that key before, so a rate
// import left the tiles stale until reload).
const PAYOR_INVALIDATE = [
  queryKeys.cases.payorContracts(),
  queryKeys.cases.payorMarginOptions(),
  queryKeys.cases.payorMarginSummaryBase,
]

export function useCreatePayorContract() {
  return useToastMutation(
    (input: CreatePayorContractInput) => createFacilityPayorContract(input),
    {
      invalidate: PAYOR_INVALIDATE,
      success: "Payor contract created",
      error: "Failed to create payor contract",
    },
  )
}

export function useUpdatePayorContract() {
  return useToastMutation(
    ({ id, input }: { id: string; input: UpdatePayorContractInput }) =>
      updateFacilityPayorContract(id, input),
    {
      invalidate: PAYOR_INVALIDATE,
      success: "Payor contract updated",
      error: "Failed to update payor contract",
    },
  )
}

export function useDeletePayorContract() {
  return useToastMutation((id: string) => deleteFacilityPayorContract(id), {
    invalidate: PAYOR_INVALIDATE,
    success: "Payor contract deleted",
    error: "Failed to delete payor contract",
  })
}

export function useImportPayorRates() {
  return useToastMutation(
    ({
      contractId,
      rates,
    }: {
      contractId: string
      rates: { cptCode: string; description?: string; rate: number }[]
    }) => importPayorContractRates(contractId, rates),
    {
      invalidate: PAYOR_INVALIDATE,
      success: (result) =>
        `Imported ${result.imported} CPT rates (${result.total} total)`,
      error: "Failed to import rates",
    },
  )
}
