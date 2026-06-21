"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
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
  return useToastMutation(createVendor, {
    invalidate: [queryKeys.vendors.all],
    success: "Vendor created",
    error: "Failed to create vendor",
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
  return useToastMutation(deactivateVendor, {
    invalidate: [queryKeys.vendors.all],
    success: "Vendor deactivated",
    error: "Failed to deactivate",
  })
}
