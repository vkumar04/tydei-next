"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  listDividendProposals,
  saveDividendProposal,
  deleteDividendProposal,
} from "@/lib/actions/dividend-proposals"
import { listPayorVolumeDatasets } from "@/lib/actions/payor-volume"
import { listProformaStatements } from "@/lib/actions/proforma-statements"
import { listMedicareRateSets } from "@/lib/actions/medicare-rate-sets"

// TanStack Query hooks for the Dividend/DCF tab. Keys come from the
// query-keys factory; mutations invalidate the shared `prospective` prefix.

export function useDividendProposals(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.prospective.dividendProposals(vendorId),
    queryFn: () => listDividendProposals(),
  })
}

export function usePayorVolumeDatasets(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.prospective.payorVolumeDatasets(vendorId),
    queryFn: () => listPayorVolumeDatasets(),
  })
}

/** Uploaded facility P&L statements, keyed by the payor-volume facilityKey. */
export function useProformaStatements(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.prospective.proformaStatements(vendorId),
    queryFn: () => listProformaStatements(),
  })
}

/** Uploaded CMS ASC rate tables that shadow the built-in snapshot. */
export function useMedicareRateSets(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.prospective.medicareRateSets(vendorId),
    queryFn: () => listMedicareRateSets(),
  })
}

export function useSaveDividendProposal() {
  return useToastMutation(saveDividendProposal, {
    invalidate: [queryKeys.prospective.all],
    success: (p) => `Saved “${p.name}”`,
    error: "Failed to save the proposal",
  })
}

export function useDeleteDividendProposal() {
  return useToastMutation(deleteDividendProposal, {
    invalidate: [queryKeys.prospective.all],
    success: "Proposal deleted",
    error: "Failed to delete the proposal",
  })
}
