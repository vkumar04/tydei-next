"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import {
  linkDcfProposalToContract,
  unlinkDcfProposalFromContract,
} from "@/lib/actions/contract-dcf-links"
import {
  listMedicareRateOverrides,
  saveMedicareRateOverrides,
  removeMedicareRateOverride,
  resetMedicareRateOverrides,
} from "@/lib/actions/medicare-rate-overrides"

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

/** Hand-entered authoritative rates; these beat uploaded sets and built-ins. */
export function useMedicareRateOverrides(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.prospective.medicareRateOverrides(vendorId),
    queryFn: () => listMedicareRateOverrides(),
  })
}

export function useSaveMedicareRateOverrides() {
  return useToastMutation(saveMedicareRateOverrides, {
    invalidate: [queryKeys.prospective.all],
    success: (r) =>
      `Saved ${r.saved} authoritative rate${r.saved === 1 ? "" : "s"}`,
    error: "Failed to save the Medicare rate changes",
  })
}

export function useRemoveMedicareRateOverride() {
  return useToastMutation(removeMedicareRateOverride, {
    invalidate: [queryKeys.prospective.all],
    success: "Reverted to the underlying rate",
    error: "Failed to revert the Medicare rate",
  })
}

export function useResetMedicareRateOverrides() {
  return useToastMutation(resetMedicareRateOverrides, {
    invalidate: [queryKeys.prospective.all],
    success: (r) =>
      r.removed === 0
        ? "Nothing to reset"
        : `Reset ${r.removed} rate${r.removed === 1 ? "" : "s"} to defaults`,
    error: "Failed to reset the Medicare rates",
  })
}

/** Link a saved DCF proposal to a contract (contract DCF Analysis tab). */
export function useLinkDcfProposal() {
  const qc = useQueryClient()
  return useToastMutation(linkDcfProposalToContract, {
    invalidate: [queryKeys.prospective.all],
    success: "Proposal linked to this contract",
    error: "Failed to link the proposal",
    onSuccess: (_d, args) => {
      qc.invalidateQueries({
        queryKey: queryKeys.contracts.dcfBundle(args.contractId),
      })
    },
  })
}

export function useUnlinkDcfProposal() {
  const qc = useQueryClient()
  return useToastMutation(unlinkDcfProposalFromContract, {
    invalidate: [queryKeys.prospective.all],
    success: "Proposal unlinked",
    error: "Failed to unlink the proposal",
    onSuccess: (_d, args) => {
      qc.invalidateQueries({
        queryKey: queryKeys.contracts.dcfBundle(args.contractId),
      })
    },
  })
}
