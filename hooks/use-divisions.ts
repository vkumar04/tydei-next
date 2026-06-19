"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getVendorDivisionsWithMembers,
  getAttachableVendorUsers,
  createVendorDivision,
  updateVendorDivision,
  deleteVendorDivision,
  attachUserToDivision,
  detachUserFromDivision,
} from "@/lib/actions/division-members"

/**
 * TanStack Query hooks for vendor division membership (Settings/Users).
 * Reads key off the `divisionMembers.byVendor(vendorId)` family; every
 * mutation invalidates the whole `divisionMembers.base` prefix so both the
 * division list and the attachable-users list refresh.
 */

export function useVendorDivisionsWithMembers(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.divisionMembers.byVendor(vendorId),
    queryFn: () => getVendorDivisionsWithMembers(),
  })
}

export function useAttachableVendorUsers(vendorId: string) {
  return useQuery({
    queryKey: [...queryKeys.divisionMembers.byVendor(vendorId), "attachable"] as const,
    queryFn: () => getAttachableVendorUsers(),
  })
}

export function useCreateVendorDivision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; code: string; categories?: string[] }) =>
      createVendorDivision(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.divisionMembers.base })
    },
  })
}

export function useUpdateVendorDivision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      name: string
      code: string
      categories?: string[]
    }) => updateVendorDivision(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.divisionMembers.base })
    },
  })
}

export function useDeleteVendorDivision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteVendorDivision(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.divisionMembers.base })
    },
  })
}

export function useAttachUserToDivision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { divisionId: string; userId: string }) =>
      attachUserToDivision(input.divisionId, input.userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.divisionMembers.base })
    },
  })
}

export function useDetachUserFromDivision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { divisionId: string; userId: string }) =>
      detachUserFromDivision(input.divisionId, input.userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.divisionMembers.base })
    },
  })
}
