"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getContracts,
  getContract,
  getContractStats,
  createContract,
  updateContract,
  deleteContract,
} from "@/lib/actions/contracts"
import type { ContractFilters } from "@/lib/validators/contracts"
import type { FacilityScope } from "@/lib/actions/contracts-auth"
import { toast } from "sonner"

export function useContracts(facilityId: string, filters?: Partial<ContractFilters>) {
  return useQuery({
    queryKey: queryKeys.contracts.list(facilityId, filters),
    queryFn: () => getContracts({ ...filters, facilityId }),
  })
}

export function useContract(
  id: string,
  periodId?: string,
  options?: {
    initialData?: Awaited<ReturnType<typeof getContract>>
  },
) {
  return useQuery({
    queryKey: queryKeys.contracts.detail(id, periodId),
    queryFn: () => getContract(id, periodId ? { periodId } : undefined),
    enabled: !!id,
    // W2.A.5 — `initialData` seeds the React Query cache with the
    // server-rendered payload so the first client render already has
    // the full contract (no "$0" flash on the header cards). Only
    // applies when no `periodId` filter is active — the server pre-
    // fetches the all-periods view.
    initialData: periodId ? undefined : options?.initialData,
  })
}

export function useContractStats(
  facilityId: string,
  scope: FacilityScope = "this",
) {
  return useQuery({
    queryKey: queryKeys.contracts.stats(facilityId, scope),
    queryFn: () => getContractStats({ facilityScope: scope }),
  })
}

// Charles W1.X-D: `useContractMetricsBatch` + `getContractMetricsBatch`
// were removed because they duplicated the canonical reducers already
// computed in-memory by `getContracts` (rebateEarned, rebateCollected,
// currentSpend). The dual sources produced list-vs-detail drift; the
// single source now lives on each contract row returned by
// `getContracts` via the canonical helpers.

export function useCreateContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createContract,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
      toast.success("Contract created successfully")
    },
    onError: (error) => {
      toast.error(humanizeServerActionError(error, "Failed to create contract"))
    },
  })
}

// Bug #9: Next.js redacts server-action error messages in production
// builds to "An error occurred in the Server Components render. The
// specific message could not be production builds to avoid leaking
// sensitive details. A digest property is included on this error
// instance which may provide additional details about the nature of
// the error." That string is useless in a toast — it tells the user
// nothing about what failed and how to recover. When we detect the
// prod-redaction wrapper, replace it with a friendlier fallback that
// names the action and points the user at server logs (where the
// `console.error("[createContract]", err, …)` breadcrumb trail lives).
//
// In development mode (or when the action returned a humanized message
// via `throw new Error("Contract validation failed at …")`), the
// original message is preserved.
function humanizeServerActionError(
  error: unknown,
  fallback: string,
): string {
  const msg =
    error instanceof Error ? error.message : String(error ?? "")
  if (!msg) return fallback
  if (
    msg.startsWith("An error occurred in the Server Components render") ||
    msg.includes("specific message could not be") ||
    msg.includes("digest property")
  ) {
    return `${fallback}. The server logged the specific reason — ask an engineer to grep the server logs for the digest hash.`
  }
  return msg
}

export function useUpdateContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateContract>[1] }) =>
      updateContract(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(variables.id),
      })
      toast.success("Contract updated successfully")
    },
    onError: (error) => {
      toast.error(humanizeServerActionError(error, "Failed to update contract"))
    },
  })
}

export function useDeleteContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteContract,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
      toast.success("Contract deleted successfully")
    },
    onError: (error) => {
      toast.error(humanizeServerActionError(error, "Failed to delete contract"))
    },
  })
}
