"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getVendorPendingContracts,
  createPendingContract,
  updatePendingContract,
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
      toast.success("Contract submitted for review")
    },
    onError: (e) => toast.error(e.message || "Failed to submit contract"),
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

export function useApprovePendingContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reviewedBy }: { id: string; reviewedBy: string }) =>
      approvePendingContract(id, reviewedBy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendingContracts"] })
      qc.invalidateQueries({ queryKey: queryKeys.contracts.all })
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendingContracts"] })
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendingContracts"] })
      toast.success("Revision requested")
    },
    onError: (e) => toast.error(e.message || "Failed to request revision"),
  })
}
