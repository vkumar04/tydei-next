"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getFacilityAssignments,
  assignFacilityToUser,
  unassignFacilityFromUser,
} from "@/lib/actions/facility-assignment"

/**
 * TanStack Query hooks for per-user facility assignment (Settings/Users).
 * Reads key off the `facilityAssignment.forOrg(orgId)` family; every
 * mutation invalidates the whole `facilityAssignment.base` prefix so the
 * assignment matrix refreshes.
 */

export function useFacilityAssignments(orgId: string) {
  return useQuery({
    queryKey: queryKeys.facilityAssignment.forOrg(orgId),
    queryFn: () => getFacilityAssignments(),
  })
}

export function useAssignFacilityToUser() {
  return useToastMutation(
    (input: { userId: string; facilityId: string }) =>
      assignFacilityToUser(input.userId, input.facilityId),
    { invalidate: [queryKeys.facilityAssignment.base] },
  )
}

export function useUnassignFacilityFromUser() {
  return useToastMutation(
    (input: { userId: string; facilityId: string }) =>
      unassignFacilityFromUser(input.userId, input.facilityId),
    { invalidate: [queryKeys.facilityAssignment.base] },
  )
}
