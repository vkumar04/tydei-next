"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getVendorDivisionsWithMembers,
  getAttachableVendorUsers,
  createVendorDivision,
  updateVendorDivision,
  deleteVendorDivision,
  attachUserToDivision,
  detachUserFromDivision,
} from "@/lib/actions/division-members"
import { getMyVendorDivisions } from "@/lib/actions/division-auth"

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
  return useToastMutation(
    (input: { name: string; code: string; categories?: string[] }) =>
      createVendorDivision(input),
    { invalidate: [queryKeys.divisionMembers.base] },
  )
}

export function useUpdateVendorDivision() {
  return useToastMutation(
    (input: { id: string; name: string; code: string; categories?: string[] }) =>
      updateVendorDivision(input),
    { invalidate: [queryKeys.divisionMembers.base] },
  )
}

export function useDeleteVendorDivision() {
  return useToastMutation((id: string) => deleteVendorDivision(id), {
    invalidate: [queryKeys.divisionMembers.base],
  })
}

export function useAttachUserToDivision() {
  return useToastMutation(
    (input: { divisionId: string; userId: string }) =>
      attachUserToDivision(input.divisionId, input.userId),
    { invalidate: [queryKeys.divisionMembers.base] },
  )
}

export function useDetachUserFromDivision() {
  return useToastMutation(
    (input: { divisionId: string; userId: string }) =>
      detachUserFromDivision(input.divisionId, input.userId),
    { invalidate: [queryKeys.divisionMembers.base] },
  )
}

/** The caller's own pickable divisions (proposal-builder division selector). */
export function useMyVendorDivisions() {
  return useQuery({
    queryKey: queryKeys.divisionMembers.mine,
    queryFn: () => getMyVendorDivisions(),
  })
}
