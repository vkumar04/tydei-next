"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { queryKeys, type DateRange } from "@/lib/query-keys"
import {
  calculateDepreciation,
  getPriceProjections,
  getVendorSpendTrends,
  getCategorySpendTrends,
} from "@/lib/actions/analysis"
import { toast } from "sonner"

export function useDepreciation() {
  return useMutation({
    mutationFn: calculateDepreciation,
    onError: (err) => toast.error(err.message || "Depreciation calculation failed"),
  })
}

export function usePriceProjections(
  facilityId: string,
  filters?: { vendorId?: string; categoryId?: string; periods?: number }
) {
  return useQuery({
    queryKey: queryKeys.analysis.priceProjections(facilityId, filters),
    queryFn: () =>
      getPriceProjections({
        facilityId,
        vendorId: filters?.vendorId,
        categoryId: filters?.categoryId,
        periods: filters?.periods ?? 12,
      }),
  })
}

export function useVendorSpendTrends(
  facilityId: string,
  dateRange?: DateRange
) {
  return useQuery({
    queryKey: queryKeys.analysis.vendorSpendTrends(facilityId, dateRange),
    queryFn: () =>
      getVendorSpendTrends({
        facilityId,
        dateFrom: dateRange?.from ?? "",
        dateTo: dateRange?.to ?? "",
      }),
    enabled: !!dateRange?.from && !!dateRange?.to,
  })
}

export function useCategorySpendTrends(
  facilityId: string,
  dateRange?: DateRange
) {
  return useQuery({
    queryKey: queryKeys.analysis.categorySpendTrends(facilityId, dateRange),
    queryFn: () =>
      getCategorySpendTrends({
        facilityId,
        dateFrom: dateRange?.from ?? "",
        dateTo: dateRange?.to ?? "",
      }),
    enabled: !!dateRange?.from && !!dateRange?.to,
  })
}
