"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getVendorPendingContracts,
  createPendingContract,
  withdrawPendingContract,
  deletePendingContract,
  getFacilityPendingContracts,
  approvePendingContract,
  rejectPendingContract,
  requestRevision,
} from "@/lib/actions/pending-contracts"
import { toast } from "sonner"

// ─── Vendor Hooks ───────────────────────────────────────────────

export function useVendorPendingContracts(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.pendingContracts.vendor(vendorId),
    queryFn: () => getVendorPendingContracts(vendorId),
  })
}

export function useCreatePendingContract() {
  // Charles audit round-2 vendor CONCERN 2: success/error toast moved to the
  // caller (vendor-contract-submission.tsx) so the multi-facility fan-out can
  // roll up "submitted to N of M facilities" into one message instead of N
  // stacked toasts — hence no `success`/`error` here (silent).
  //
  // Charles 2026-07-27: `contracts.all` joined the list because creation is no
  // longer guaranteed to produce only a pending row — in one-way mode the
  // action materializes a real Contract on the spot
  // (lib/connections/operating-mode.ts), and the vendor is redirected straight
  // to /vendor/contracts, which reads that key.
  return useToastMutation(createPendingContract, {
    invalidate: [queryKeys.pendingContracts.all, queryKeys.contracts.all],
  })
}

export function useWithdrawPendingContract() {
  return useToastMutation(withdrawPendingContract, {
    invalidate: [queryKeys.pendingContracts.all],
    success: "Contract withdrawn",
    error: "Failed to withdraw",
  })
}

/**
 * Bug-bash 2026-06-11 B2: vendors can remove a non-approved submission
 * (submitted / rejected / revision_requested / draft / withdrawn) from
 * "My Contracts". Active contracts are never deletable — the server
 * action guards `approved`, and real Contract rows never reach it.
 */
export function useDeletePendingContract() {
  return useToastMutation(deletePendingContract, {
    invalidate: [queryKeys.pendingContracts.all],
    success: "Submission deleted",
    error: "Failed to delete",
  })
}

// ─── Facility Hooks ─────────────────────────────────────────────

export function useFacilityPendingContracts(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.pendingContracts.facility(facilityId),
    queryFn: () => getFacilityPendingContracts(facilityId),
  })
}

/**
 * Charles 2026-05-25 (latest-patterns audit): approving a pending contract
 * creates a new `Contract` row that touches multiple aggregating surfaces
 * on the facility's UI: dashboard KPIs, alerts (renewal / off-contract
 * watchers), purchase-order compliance counts, COG match-status stats,
 * and the contract-list itself. Per TanStack Query v5 docs, the canonical
 * pattern is to invalidate every key whose data the mutation could have
 * changed. Returning the Promise from `onSuccess` keeps the mutation in
 * `pending` state until all refetches settle so the UI stays consistent.
 */
function invalidateAllContractDownstream(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.pendingContracts.all }),
    qc.invalidateQueries({ queryKey: queryKeys.contracts.all }),
    qc.invalidateQueries({ queryKey: queryKeys.alerts.all }),
    qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all }),
    qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all }),
    qc.invalidateQueries({ queryKey: queryKeys.categories.all }),
  ])
}

export function useApprovePendingContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reviewedBy }: { id: string; reviewedBy: string }) =>
      approvePendingContract(id, reviewedBy),
    onSuccess: async () => {
      await invalidateAllContractDownstream(qc)
      toast.success("Contract approved")
    },
    onError: (e) => toast.error(e.message || "Failed to approve"),
  })
}

export function useRejectPendingContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reviewedBy, notes }: { id: string; reviewedBy: string; notes: string }) =>
      rejectPendingContract(id, reviewedBy, notes),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.pendingContracts.all })
      toast.success("Contract rejected")
    },
    onError: (e) => toast.error(e.message || "Failed to reject"),
  })
}

export function useRequestRevision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reviewedBy, notes }: { id: string; reviewedBy: string; notes: string }) =>
      requestRevision(id, reviewedBy, notes),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.pendingContracts.all })
      toast.success("Revision requested")
    },
    onError: (e) => toast.error(e.message || "Failed to request revision"),
  })
}
