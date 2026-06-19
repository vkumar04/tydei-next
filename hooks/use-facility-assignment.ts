"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; facilityId: string }) =>
      assignFacilityToUser(input.userId, input.facilityId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.facilityAssignment.base })
    },
  })
}

export function useUnassignFacilityFromUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; facilityId: string }) =>
      unassignFacilityFromUser(input.userId, input.facilityId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.facilityAssignment.base })
    },
  })
}
