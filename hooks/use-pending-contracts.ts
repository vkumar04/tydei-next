"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getVendorPendingContracts,
  createPendingContract,
  withdrawPendingContract,
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createPendingContract,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendingContracts"] })
    },
    // Charles audit round-2 vendor CONCERN 2: success/error toast
    // moved to the caller (vendor-contract-submission.tsx) so the
    // multi-facility fan-out can roll up "submitted to N of M
    // facilities" into one message instead of N stacked toasts.
    // The caller uses Promise.allSettled and reports per-facility
    // failures in a single rolled-up error toast.
  })
}

export function useWithdrawPendingContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: withdrawPendingContract,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendingContracts"] })
      toast.success("Contract withdrawn")
    },
    onError: (e) => toast.error(e.message || "Failed to withdraw"),
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
    qc.invalidateQueries({ queryKey: ["pendingContracts"] }),
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
      await qc.invalidateQueries({ queryKey: ["pendingContracts"] })
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
      await qc.invalidateQueries({ queryKey: ["pendingContracts"] })
      toast.success("Revision requested")
    },
    onError: (e) => toast.error(e.message || "Failed to request revision"),
  })
}
