"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getContracts,
  getContract,
  getContractStats,
  getContractMetricsBatch,
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

export function useContract(id: string, periodId?: string) {
  return useQuery({
    queryKey: queryKeys.contracts.detail(id, periodId),
    queryFn: () => getContract(id, periodId ? { periodId } : undefined),
    enabled: !!id,
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

/**
 * Per-row live metrics (spend / rebate / totalValue) for a batch of
 * contract ids. Loaded in parallel with the main contracts list so
 * the UI can render the metrics columns without an extra round-trip.
 */
export function useContractMetricsBatch(contractIds: string[]) {
  return useQuery({
    queryKey: ["contracts", "metricsBatch", contractIds.slice().sort().join(",")],
    queryFn: () => getContractMetricsBatch(contractIds),
    enabled: contractIds.length > 0,
  })
}

export function useCreateContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createContract,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
      toast.success("Contract created successfully")
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create contract")
    },
  })
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
      toast.error(error.message || "Failed to update contract")
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
      toast.error(error.message || "Failed to delete contract")
    },
  })
}
