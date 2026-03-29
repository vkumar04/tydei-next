"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePOStatus,
  searchProducts,
  getPOStats,
  getFacilityVendors,
} from "@/lib/actions/purchase-orders"
import type { POFilters, CreatePOInput } from "@/lib/validators/purchase-orders"
import type { POStatus } from "@prisma/client"
import { toast } from "sonner"

export function usePurchaseOrders(facilityId: string, filters?: Partial<POFilters>) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.list(facilityId, filters),
    queryFn: () => getPurchaseOrders({ facilityId, ...filters }),
  })
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.detail(id),
    queryFn: () => getPurchaseOrder(id),
    enabled: !!id,
  })
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createPurchaseOrder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      toast.success("Purchase order created")
    },
    onError: (e) => toast.error(e.message || "Failed to create PO"),
  })
}

export function useUpdatePOStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: POStatus }) =>
      updatePOStatus(id, status),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.detail(variables.id) })
      toast.success("PO status updated")
    },
    onError: (e) => toast.error(e.message || "Failed to update status"),
  })
}

export function useProductSearch(facilityId: string, query: string, vendorId?: string) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.productSearch(facilityId, query),
    queryFn: () => searchProducts({ facilityId, query, vendorId }),
    enabled: query.length >= 2,
  })
}

export function usePOStats(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.stats(facilityId),
    queryFn: () => getPOStats(facilityId),
  })
}

export function useFacilityVendors(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.vendors(facilityId),
    queryFn: () => getFacilityVendors(facilityId),
  })
}
