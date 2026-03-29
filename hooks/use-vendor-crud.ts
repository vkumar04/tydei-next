"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getVendorList,
  getVendor,
  createVendor,
  updateVendor,
  deactivateVendor,
} from "@/lib/actions/vendors"
import type { VendorFilters } from "@/lib/validators/vendors"
import { toast } from "sonner"

export function useVendorList(filters?: VendorFilters) {
  return useQuery({
    queryKey: queryKeys.vendors.list(filters),
    queryFn: () => getVendorList(filters ?? {}),
  })
}

export function useVendorDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.vendors.detail(id),
    queryFn: () => getVendor(id),
    enabled: !!id,
  })
}

export function useCreateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createVendor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
      toast.success("Vendor created")
    },
    onError: (err) => toast.error(err.message || "Failed to create vendor"),
  })
}

export function useUpdateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Parameters<typeof updateVendor>[1]
    }) => updateVendor(id, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
      qc.invalidateQueries({
        queryKey: queryKeys.vendors.detail(variables.id),
      })
      toast.success("Vendor updated")
    },
    onError: (err) => toast.error(err.message || "Failed to update vendor"),
  })
}

export function useDeactivateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deactivateVendor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
      toast.success("Vendor deactivated")
    },
    onError: (err) => toast.error(err.message || "Failed to deactivate"),
  })
}
