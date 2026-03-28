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
import { toast } from "sonner"

export function useContracts(facilityId: string, filters?: Partial<ContractFilters>) {
  return useQuery({
    queryKey: queryKeys.contracts.list(facilityId, filters),
    queryFn: () => getContracts({ ...filters, facilityId }),
  })
}

export function useContract(id: string) {
  return useQuery({
    queryKey: queryKeys.contracts.detail(id),
    queryFn: () => getContract(id),
    enabled: !!id,
  })
}

export function useContractStats(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.contracts.stats(facilityId),
    queryFn: () => getContractStats(),
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
